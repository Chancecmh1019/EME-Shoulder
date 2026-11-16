"""Offline measured transcription. Never feed source lyrics as a recognition prompt."""
import os, sys, json, time, pathlib, subprocess, hashlib, re, difflib
root=pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'.studio/python'))
from faster_whisper import WhisperModel
import imageio_ffmpeg
import numpy as np
audio, output, model_name, language=sys.argv[1:5]
if model_name not in ['tiny.en','base.en','small.en','tiny','base','small','medium']: raise ValueError('MODEL_NOT_ALLOWED')
started=time.time()
def progress(stage, **fields):
 pathlib.Path(output+'.progress.json').write_text(json.dumps({'stage':stage,'updatedAt':time.time(),'elapsedSeconds':time.time()-started,**fields}),encoding='utf-8')
progress('FULL_DECODE')
decode=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-nostdin','-v','error','-xerror','-i',audio,'-map','0:a:0','-ac','1','-ar','16000','-f','f32le','pipe:1'],capture_output=True,timeout=180)
if decode.returncode: raise RuntimeError('FULL_AUDIO_DECODE_FAILED: '+decode.stderr.decode(errors='replace')[:500])
if len(decode.stdout)%4:raise ValueError('INVALID_DECODED_PCM_LENGTH')
samples=np.frombuffer(decode.stdout,dtype='<f4').copy()
if len(samples)==0: raise ValueError('EMPTY_AUDIO')
duration=len(samples)/16000
inspection={'decoded':True,'durationMs':round(duration*1000),'sampleRate':16000,'channels':1,'rms':float(np.sqrt(np.mean(samples*samples))),'peak':float(np.max(np.abs(samples))),'audibleFraction':float(np.mean(np.abs(samples)>.01)),'clippedFraction':float(np.mean(np.abs(samples)>=.999))}
progress('LOAD_MODEL',durationMs=round(duration*1000),model=model_name)
model=WhisperModel(model_name,device='cpu',compute_type='int8',cpu_threads=4,download_root=str(root/'.studio/models'))
scope = os.environ.get('EME_ASR_SCOPE', 'boundaries')
clips = [0, duration] if scope == 'full' or duration <= 60 else [0, 30, duration - 30, duration]
segments,info=model.transcribe(samples,language=language if language!='auto' else None,beam_size=5,word_timestamps=True,condition_on_previous_text=False,vad_filter=False,initial_prompt=None,clip_timestamps=clips)
result=[]
progress('TRANSCRIBE',durationMs=round(duration*1000),model=model_name,analyzedThroughMs=0)
for s in segments:
 result.append({'startMs':round(s.start*1000),'endMs':round(s.end*1000),'text':s.text,'avgLogprob':s.avg_logprob,'noSpeechProbability':s.no_speech_prob,'words':[{'text':w.word,'startMs':round(w.start*1000),'endMs':round(w.end*1000),'probability':w.probability} for w in (s.words or [])]})
 progress('TRANSCRIBE',durationMs=round(duration*1000),model=model_name,analyzedThroughMs=round(s.end*1000))
report={'method':'local-faster-whisper','model':model_name,'inspection':inspection,'segments':result,'elapsedSeconds':time.time()-started,'audioSha256':hashlib.file_digest(open(audio,'rb'),'sha256').hexdigest(),'lyricsUsedAsPrompt':False}
report['transcriptionScope']='full-song' if scope == 'full' or duration <= 60 else 'first-and-last-30-seconds'
report['detectedLanguage']=info.language
report['languageProbability']=info.language_probability
if len(sys.argv)>5:
 lrc_path=pathlib.Path(sys.argv[5]);lrc=lrc_path.read_text(encoding='utf-8-sig');lines=[]
 for line in lrc.splitlines():
  m=re.fullmatch(r'\[(\d+):([0-5]\d)\.(\d{3})\](.+)',line)
  if m:lines.append({'timeMs':int(m[1])*60000+int(m[2])*1000+int(m[3]),'original':m[4]})
 def words(text):return re.findall(r"[^\W_]+(?:['’][^\W_]+)?",text.lower().replace('’',"'"),re.UNICODE)
 source_words=[];ranges=[]
 for line in lines:
  start=len(source_words);source_words.extend(words(line['original']));ranges.append((start,len(source_words)))
 recognized=[]
 for segment in result:
  for word in segment['words']:
   for text in words(word['text']):recognized.append({**word,'token':text})
 matcher=difflib.SequenceMatcher(None,source_words,[w['token'] for w in recognized],autojunk=False)
 mapping={};used=set()
 for block in matcher.get_matching_blocks():
  for k in range(block.size):mapping[block.a+k]=block.b+k;used.add(block.b+k)
 aligned=[];offsets=[]
 for i,(a,b) in enumerate(ranges):
  found=[mapping[k] for k in range(a,b) if k in mapping];coverage=len(found)/max(1,b-a)
  entry={**lines[i],'lineId':'line-'+str(i+1),'lexicalCoverage':coverage,'matchedWords':len(found),'sourceWords':b-a}
  if found:
   first,last=min(found),max(found);entry.update({'observedStartMs':recognized[first]['startMs'],'observedEndMs':recognized[last]['endMs'],'transcribedFragment':' '.join(w['text'].strip() for w in recognized[first:last+1]),'minimumWordProbability':min(w['probability'] for w in recognized[first:last+1])})
   if coverage>=.8:offsets.append(entry['observedStartMs']-entry['timeMs'])
  aligned.append(entry)
 coverage=len(mapping)/max(1,len(source_words));extra=1-len(used)/max(1,len(recognized));median=float(np.median(offsets)) if offsets else None
 spread=float(np.percentile(np.abs(np.array(offsets)-median),90)) if offsets else None
 weak=[x['lineId'] for x in aligned if x['lexicalCoverage']<.8]
 text_pass=coverage>=.92 and extra<=.10 and not weak
 diagnosis='INSUFFICIENT_EVIDENCE'
 if text_pass and spread is not None:
  if spread>1000:diagnosis='SECTION_DRIFT'
  elif abs(median)>250:diagnosis='GLOBAL_OFFSET'
  else:diagnosis='PAIR_VERIFIED'
 report['verification']={'diagnosis':diagnosis,'translationAllowed':diagnosis=='PAIR_VERIFIED','sourceSha256':hashlib.sha256(lrc_path.read_bytes()).hexdigest(),'coverage':coverage,'unmatchedRecognizedFraction':extra,'weakLines':weak,'medianOffsetMs':median,'p90ResidualDriftMs':spread,'lines':aligned,'thresholds':{'minimumOverallCoverage':.92,'minimumEveryLineCoverage':.8,'maximumUnmatchedRecognizedFraction':.10,'maximumP90ResidualDriftMs':1000,'maximumUncorrectedOffsetMs':250},'limits':'ASR is fallible; low correspondence blocks rather than proving which asset is wrong. No lyric text was supplied to the recognizer. No owner listening attestation is fabricated.'}
pathlib.Path(output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
progress('COMPLETE',durationMs=round(duration*1000),analyzedThroughMs=round(duration*1000),diagnosis=report.get('verification',{}).get('diagnosis'))
print(json.dumps({'report':output,'segments':len(result),'duration':duration,'elapsedSeconds':time.time()-started,'verification':{k:v for k,v in report.get('verification',{}).items() if k not in ['lines','limits','thresholds']}}))
