// ★ 우리 학교에 맞게 수정하세요.
// 좌표 찾는 법: https://www.openstreetmap.org 에서 건물을 우클릭 → "여기를 중심으로" → 주소창의 숫자(위도/경도)
// 아래 값은 예시입니다.
export const CAMPUS = {
  name: '우리대학교',
  center: [37.5665, 126.978],
  zoom: 17,
};

export const BUILDINGS = [
  { name: '본관', lat: 37.5668, lng: 126.9775 },
  { name: '중앙도서관', lat: 37.5661, lng: 126.9772 },
  { name: '학생회관', lat: 37.5664, lng: 126.9787 },
  { name: '1공학관', lat: 37.5671, lng: 126.979 },
  { name: '2공학관', lat: 37.5674, lng: 126.9782 },
  { name: '인문관', lat: 37.5658, lng: 126.9781 },
  { name: '학생식당', lat: 37.566, lng: 126.9792 },
  { name: '체육관', lat: 37.5655, lng: 126.9773 },
  { name: '기숙사', lat: 37.5678, lng: 126.9771 },
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
