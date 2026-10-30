'use client';
// 학교 지도 (OpenStreetMap + Leaflet). 건물 점을 누르면 건물 선택, 지도 아무 곳이나 누르면 정확한 위치 핀.
// SSR에서 window가 없으므로 페이지에서는 next/dynamic(ssr:false)으로 불러온다.
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMapEvents } from 'react-leaflet';
import { BUILDINGS, CAMPUS, nearestBuilding } from '@/lib/campus';

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      onPick({ lat, lng, building: nearestBuilding(lat, lng)?.name });
    },
  });
  return null;
}

export default function MapPicker({ value, onChange, readOnly = false, height = 320 }) {
  const center = value?.lat ? [value.lat, value.lng] : CAMPUS.center;
  return (
    <MapContainer center={center} zoom={CAMPUS.zoom} style={{ height, borderRadius: 14 }} scrollWheelZoom={!readOnly}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {BUILDINGS.map((b) => {
        const selected = value?.building === b.name;
        return (
          <CircleMarker
            key={b.name}
            center={[b.lat, b.lng]}
            radius={selected ? 11 : 8}
            pathOptions={{ color: selected ? '#5b4fcf' : '#8f86d6', fillColor: selected ? '#5b4fcf' : '#c9c2ff', fillOpacity: 0.85 }}
            bubblingMouseEvents={false}
            eventHandlers={readOnly ? {} : { click: () => onChange({ lat: b.lat, lng: b.lng, building: b.name }) }}
          >
            <Tooltip permanent={selected} direction="top">{b.name}</Tooltip>
          </CircleMarker>
        );
      })}
      {value?.lat && (
        <CircleMarker center={[value.lat, value.lng]} radius={7} pathOptions={{ color: '#e5486b', fillColor: '#ff7a95', fillOpacity: 1 }}>
          <Tooltip direction="bottom">발견 위치</Tooltip>
        </CircleMarker>
      )}
      {!readOnly && <ClickHandler onPick={onChange} />}
    </MapContainer>
  );
}
