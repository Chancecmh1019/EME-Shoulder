import React from 'react';
import type { AlbumProject } from '../types';
import { useMediaUrl } from './hooks';
export function AlbumIdentity({ album }: { album: AlbumProject }) {
  const url = useMediaUrl(album.artworkKey);
  return <div className="album-identity">{url ? <img src={url} alt={`${album.title} 封面`}/> : <div className="cover-empty">E / M / E</div>}<small>ALBUM PROJECT</small><h2>{album.title}</h2><p>{album.artist}</p><small>{album.tracks.length} tracks · {album.tracks.filter(t => t.publish === 'completed').length} uploaded</small></div>;
}
