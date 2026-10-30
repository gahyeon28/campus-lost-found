export const CAMPUS = {
  name: '가천대학교',
  center: [37.45104, 127.12986],
  zoom: 17,
};

export const BUILDINGS = [
  { name: '중앙도서관', lat: 37.452206, lng: 127.133027 },
  { name: '반도체대학', lat: 37.450943, lng: 127.127094 },
  { name: '비전타워', lat: 37.449648, lng: 127.127126 },
  { name: '글로벌센터', lat: 37.451882, lng: 127.127105 },
  { name: 'AI공학관', lat: 37.455272, lng: 127.134004 },
  { name: 'AI도서관', lat: 37.450611, lng: 127.128516 },
  { name: '가천관', lat: 37.450301, lng: 127.129691 },
  { name: '가천대역 지하철', lat: 37.448836, lng: 127.126949 },
  { name: '공과대학2', lat: 37.449228, lng: 127.128484 },
  { name: '한의과대학', lat: 37.450029, lng: 127.128505 },
  { name: '공과대학1', lat: 37.451567, lng: 127.127958 },
  { name: '예술체육대학1', lat: 37.452269, lng: 127.128698 },
  { name: '예술체육대학2', lat: 37.451659, lng: 127.129648 },
  { name: '바람개비동산', lat: 37.452005, lng: 127.130576 },
  { name: '프리덤광장', lat: 37.449861, lng: 127.127438 },
  { name: '스타덤광장', lat: 37.450711, lng: 127.127894 },
  { name: '교육대학원', lat: 37.451822, lng: 127.131649 },
  { name: '학생회관', lat: 37.453126, lng: 127.134449 },
  { name: '대운동장', lat: 37.455046, lng: 127.135195 },
  { name: '제3학생생활관', lat: 37.455842, lng: 127.133258 },
  { name: '제2학생생활관', lat: 37.456042, lng: 127.134207 },
  { name: '제1학생생활관', lat: 37.456336, lng: 127.135146 },
];

export function nearestBuilding(lat, lng) {
  let best = null;
  let bestD = Infinity;
  for (const b of BUILDINGS) {
    const d = (b.lat - lat) ** 2 + ((b.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) [best, bestD] = [b, d];
  }
  return best;
}
