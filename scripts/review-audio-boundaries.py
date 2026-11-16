"""Owner-selected minimum policy: independent first/last ASR anchors, not perfect-song ASR.

Uses an existing full transcription; never re-downloads audio or prompts ASR with lyrics.
The original strict report is immutable input and remains available for review.
"""
import difflib
import hashlib
import json
import pathlib
import re
import sys
import unicodedata


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold() if c.isalnum())


def anchor(line, words, duration_ms):
    expected = normalized(line['original'])
    nearby = [w for w in words if line['timeMs'] - 6000 <= w['startMs'] <= line['timeMs'] + 6000]
    candidates = []
    for start in range(len(nearby)):
        for end in range(start + 1, min(len(nearby), start + 20) + 1):
            group = nearby[start:end]
            text = ''.join(normalized(w['text']) for w in group)
            if not text or len(text) > max(8, len(expected) * 1.5):
                continue
            score = difflib.SequenceMatcher(None, expected, text, autojunk=False).ratio()
            candidates.append((score, -abs(group[0]['startMs'] - line['timeMs']), group))
    if not candidates or len(expected) < 4:
        return {**line, 'passed': False, 'reason': 'BOUNDARY_TEXT_TOO_SHORT_OR_NOT_RECOGNIZED'}
    score, _, group = max(candidates, key=lambda candidate: (candidate[0], candidate[1]))
    probability = sum(w['probability'] for w in group) / len(group)
    offset = group[0]['startMs'] - line['timeMs']
    return {**line, 'textSimilarity': score, 'meanWordProbability': probability,
            'observedText': ''.join(w['text'] for w in group), 'observedStartMs': group[0]['startMs'],
            'observedEndMs': group[-1]['endMs'], 'offsetMs': offset,
            'passed': score >= .8 and probability >= .5 and abs(offset) <= 1500 and group[-1]['endMs'] <= duration_ms + 500}


def review(report, tail=None):
    lines = report['verification']['lines']
    words = [word for segment in report['segments'] for word in segment['words']]
    if len(lines) < 2 or not report.get('inspection', {}).get('decoded') or report.get('lyricsUsedAsPrompt') is not False:
        raise ValueError('FULL_DECODE_AND_INDEPENDENT_TRANSCRIPTION_REQUIRED')
    first = anchor(lines[0], words, report['inspection']['durationMs'])
    tail_words = words
    if tail is not None:
        if tail.get('audioSha256') != report['audioSha256'] or tail.get('lyricsUsedAsPrompt') is not False or tail.get('fullAudioDecoded') is not True:
            raise ValueError('ENDING_RECOVERY_EVIDENCE_MISMATCH')
        tail_words = [word for segment in tail['segments'] for word in segment['words']]
    last = anchor(lines[-1], tail_words, report['inspection']['durationMs'])
    drift = abs(first.get('offsetMs', 999999) - last.get('offsetMs', -999999))
    passed = first['passed'] and last['passed'] and drift <= 1500
    return {'policy': 'owner-first-last-v1', 'requestedByOwner': '2026-11-16: first and last lyric correspondence; perfect full-song ASR not required',
            'diagnosis': 'PAIR_VERIFIED' if passed else 'INSUFFICIENT_EVIDENCE', 'translationAllowed': passed,
            'audioSha256': report['audioSha256'], 'sourceSha256': report['verification']['sourceSha256'],
            'first': first, 'last': last, 'boundaryDriftMs': drift,
            'strictWholeSongDiagnosis': report['verification']['diagnosis'],
            'strictWholeSongCoverage': report['verification']['coverage'],
            'interiorWeakLines': report['verification']['weakLines'],
            'thresholds': {'minimumBoundaryTextSimilarity': .8, 'minimumMeanWordProbability': .5, 'maximumBoundaryOffsetMs': 1500, 'maximumBoundaryDriftMs': 1500},
            'limits': 'Only first and last lines are mandatory under the owner-selected policy. Interior weak lines remain warnings. This does not certify perfect synchronization, semantic translation, recording rights, or human listening.'}


if __name__ == '__main__':
    source, output = map(pathlib.Path, sys.argv[1:3])
    tail = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else None
    result = review(json.loads(source.read_text(encoding='utf-8')), json.loads(tail.read_text(encoding='utf-8')) if tail else None)
    if tail:
        result['endingRecoveryReportSha256'] = hashlib.sha256(tail.read_bytes()).hexdigest()
    result['transcriptionReportSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: result[key] for key in ['policy', 'diagnosis', 'translationAllowed', 'boundaryDriftMs']}))
