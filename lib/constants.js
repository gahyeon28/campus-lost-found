// 카테고리 목록은 supabase/schema.sql 의 items.category check 와 같아야 한다.
export const CATEGORIES = ['전자기기', '지갑/카드', '의류', '가방', '책/문구', '기타'];
export const CATEGORY_EMOJI = { 전자기기: '🎧', '지갑/카드': '💳', 의류: '🧥', 가방: '🎒', '책/문구': '📚', 기타: '📦' };

export const COLORS = ['검정', '흰색', '회색', '빨강', '주황', '노랑', '초록', '파랑', '남색', '보라', '분홍', '갈색', '베이지', '은색', '금색', '투명', '기타'];

export const STATUSES = ['보관중', '수령 대기', '수령 완료', '장기 미수령'];
export const STORAGE_TYPES = ['발견한 자리에 그대로', '근처 공용 장소에 맡김'];
export const REPORT_REASONS = ['허위 게시물', '부적절한 사진/내용', '개인정보 노출', '이미 반환됨', '기타'];

// 이 카테고리이거나 브랜드가 있으면 확인 퀴즈를 권장
export const QUIZ_RECOMMENDED = ['전자기기', '지갑/카드', '가방'];

export const SCHOOL_DOMAIN = (process.env.NEXT_PUBLIC_SCHOOL_EMAIL_DOMAIN || 'example.ac.kr').toLowerCase();

export function isSchoolEmail(email) {
  const host = String(email || '').toLowerCase().split('@')[1] || '';
  return host === SCHOOL_DOMAIN || host.endsWith('.' + SCHOOL_DOMAIN);
}
