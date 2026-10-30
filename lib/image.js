// 업로드 전에 브라우저에서 사진을 줄인다 (긴 변 1280px, JPEG). 용량·AI 비용 절감용.
export async function shrinkImage(file, maxSide = 1280) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있어요.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  return { blob, base64, preview: URL.createObjectURL(blob) };
}
