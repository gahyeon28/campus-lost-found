'use client';
// 습득물 등록·수정 공용 폼
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { supabase, authedFetch } from '@/lib/supabase';
import { shrinkImage } from '@/lib/image';
import { CATEGORIES, COLORS, STORAGE_TYPES, QUIZ_RECOMMENDED } from '@/lib/constants';
import { BUILDINGS } from '@/lib/campus';

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false, loading: () => <p className="muted">지도 불러오는 중…</p> });

// 날짜를 datetime-local 입력 형식(로컬 시간)으로
function toLocalInput(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const localNow = () => toLocalInput(new Date());

// item이 있으면 수정, 없으면 새로 등록
export default function ItemForm({ item }) {
  const { user } = useAuth();
  const router = useRouter();
  const editing = !!item;
  const [form, setForm] = useState(() => (editing ? {
    title: item.title, category: item.category, color: item.color || '', brand: item.brand || '',
    tags: (item.tags || []).join(', '), description: item.description || '',
    found_at: toLocalInput(new Date(item.found_at)), building: item.building, location_detail: item.location_detail || '',
    lat: item.lat, lng: item.lng, storage_type: item.storage_type, storage_detail: item.storage_detail || '',
    use_quiz: !!item.quiz_question, quiz_question: item.quiz_question || '', quiz_answer: '',
  } : {
    title: '', category: '기타', color: '', brand: '', tags: '', description: '',
    found_at: '', building: '', location_detail: '', lat: null, lng: null,
    storage_type: STORAGE_TYPES[0], storage_detail: '', use_quiz: false, quiz_question: '', quiz_answer: '',
  }));
  const [photo, setPhoto] = useState(null); // { blob, base64, preview }
  const [ai, setAi] = useState({ state: 'idle', msg: '', recommended: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!editing) setForm((f) => ({ ...f, found_at: localNow() }));
  }, [editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const quizRecommended = ai.recommended || QUIZ_RECOMMENDED.includes(form.category) || !!form.brand.trim();

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await shrinkImage(file);
      setPhoto(img);
      runAi(img);
    } catch (err) {
      setError(err.message);
    }
  }

  async function runAi(img) {
    setAi({ state: 'loading', msg: '🤖 AI가 사진을 분석하는 중…', recommended: false });
    try {
      const t = await authedFetch('/api/tag', { image: img.base64 });
      setForm((f) => ({
        ...f,
        title: f.title || t.title,
        category: t.category,
        color: t.color || f.color,
        brand: t.brand || f.brand,
        tags: t.tags.join(', '),
        description: f.description || t.description,
      }));
      setAi({ state: 'done', msg: '🤖 AI가 카테고리·색상·브랜드를 채웠어요. 틀린 부분은 고쳐주세요.', recommended: t.quiz_recommended });
    } catch (err) {
      setAi({ state: 'error', msg: err.message, recommended: false });
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.building) return setError('지도에서 건물을 선택하거나 목록에서 골라주세요.');
    if (form.storage_type === STORAGE_TYPES[1] && !form.storage_detail.trim()) return setError('맡긴 장소를 적어주세요.');
    // 수정할 때 기존 퀴즈가 있으면 정답을 비워 두어도 된다 (기존 정답 유지)
    const needAnswer = !(editing && item.quiz_question);
    if (form.use_quiz && (!form.quiz_question.trim() || (needAnswer && !form.quiz_answer.trim()))) return setError('퀴즈 질문과 정답을 모두 입력해주세요.');
    setBusy(true);
    try {
      let image_path = null;
      if (photo) {
        image_path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase().storage.from('item-images').upload(image_path, photo.blob, { contentType: 'image/jpeg' });
        if (upErr) throw new Error('사진 업로드 실패: ' + upErr.message);
      }
      const payload = {
        ...form,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
        found_at: new Date(form.found_at).toISOString(),
        quiz_question: form.use_quiz ? form.quiz_question : null,
        image_path,
      };
      delete payload.quiz_answer;
      delete payload.use_quiz;
      const p_answer = form.use_quiz && form.quiz_answer.trim() ? form.quiz_answer : null;
      if (editing) {
        const { error: rpcErr } = await supabase().rpc('update_item', { p_item_id: item.id, p: payload, p_answer });
        if (rpcErr) throw new Error(rpcErr.message);
        router.push(`/items/${item.id}`);
        return;
      }
      const { data: id, error: rpcErr } = await supabase().rpc('create_item', { p: payload, p_answer });
      if (rpcErr) throw new Error(rpcErr.message);
      authedFetch('/api/notify', { itemId: id }).catch((err) => console.warn('알림 발송 실패', err));
      router.push(`/items/${id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const storageOptions = [STORAGE_TYPES[1], STORAGE_TYPES[0]]; // 시안 순서: 근처 공용 장소 → 그 자리에
  const close = () => (editing ? router.push(`/items/${item.id}`) : router.back()); // 오버레이에서 열었으면 원래 페이지로

  return (
    <div className="form-shell">
      <div className="form-head">
        <h2>{editing ? '습득물 수정' : '새 습득물 등록'}</h2>
        <button type="button" className="icon-btn" aria-label="닫기" onClick={close}>✕</button>
      </div>
      <p className="muted">{editing ? '수령 신청이 들어오기 전까지 고칠 수 있어요.' : '주운 물건을 그 자리에 두었거나 근처 공용 장소에 맡겼다면 위치를 남겨주세요.'}</p>

      <form onSubmit={submit} className="stack form-body">
        <section className="stack">
          <h3 className="step">1. 습득물 사진 {editing ? '바꾸기 (선택)' : '업로드'} (자동 압축 &amp; Gemini AI 자동 태깅)</h3>
          <label className="drop">
            <input type="file" accept="image/*" onChange={onPhoto} hidden />
            <span className="drop-icon">📷</span>
            <b>직접 사진 파일 업로드</b>
            <span className="muted">긴 변 1280px 자동 압축</span>
          </label>
          {photo && <img src={photo.preview} alt="미리보기" style={{ maxWidth: 260, borderRadius: 12 }} />}
          {ai.msg && <div className={`box ${ai.state === 'error' ? 'red' : 'purple'}`}>{ai.msg}</div>}
          <div className="box yellow">⚠️ 개인정보 보호를 위해 학생증·신용카드의 학번, 카드 번호 등이 보이지 않게 촬영해주세요.</div>
          <div className="muted" style={{ fontSize: 13 }}>
            지갑·전자기기 같은 고가품은 퀴즈로 낼 만한 특징(스티커, 각인, 키링, 지갑 속 내용물 등)이 사진에 보이지 않게 가리거나 뒷면만 찍어주세요. 사진에 보이면 누구나 퀴즈를 맞힐 수 있어요.
          </div>
        </section>

        <section className="stack">
          <h3 className="step">2. 물건 이름 · 카테고리 · 색상</h3>
          <label>물건 이름 *<input required maxLength={60} value={form.title} onChange={set('title')} placeholder="예: 흰색 에어팟 프로" /></label>
          <div className="row">
            <label>카테고리 *
              <select value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label>색상
              <select value={form.color} onChange={set('color')}>
                <option value="">선택 안 함</option>
                {COLORS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>브랜드<input maxLength={40} value={form.brand} onChange={set('brand')} placeholder="예: Apple" /></label>
          </div>
          <label>키워드 (쉼표로 구분)<input value={form.tags} onChange={set('tags')} placeholder="예: 이어폰, 무선, 케이스" /></label>
          <label>설명<textarea maxLength={1000} value={form.description} onChange={set('description')} placeholder="겉으로 보이는 특징 (주인만 알 만한 특징은 퀴즈로 남겨주세요)" /></label>
        </section>

        <section className="stack">
          <h3 className="step">3. 습득 건물·광장 선택 (지도 번호 클릭 또는 목록 선택)</h3>
          <MapPicker value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          <div className="row">
            <label>건물·광장 (1~22 · A~F) *
              <select value={form.building} onChange={(e) => {
                const b = BUILDINGS.find((x) => x.name === e.target.value);
                setForm({ ...form, building: e.target.value, lat: b?.lat ?? null, lng: b?.lng ?? null });
              }}>
                <option value="">선택하세요</option>
                {BUILDINGS.map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </label>
            <label>습득 일시 *
              <input type="datetime-local" required max={localNow()} value={form.found_at} onChange={set('found_at')} />
            </label>
          </div>
          <div className="choice-row">
            {storageOptions.map((t) => (
              <button key={t} type="button" className={`choice ${form.storage_type === t ? 'on' : ''}`}
                onClick={() => setForm({ ...form, storage_type: t })}>{t}</button>
            ))}
          </div>
          <label>상세 위치<input maxLength={200} value={form.location_detail} onChange={set('location_detail')} placeholder="예: 3층 열람실 창가 자리" /></label>
          <input maxLength={200} value={form.storage_detail} onChange={set('storage_detail')}
            placeholder={form.storage_type === STORAGE_TYPES[1] ? '맡긴 곳 (예: 3층 안내데스크, 1층 경비실)' : '추가 설명 (예: 책상 위에 그대로 둠)'} />
        </section>

        <section className="stack">
          <h3 className="step">4. 본인 확인 퀴즈 설정 (고가품 권장)</h3>
          <div className={`quiz-box ${quizRecommended ? 'purple' : ''}`}>
            <label className="check"><input type="checkbox" checked={form.use_quiz} onChange={set('use_quiz')} /> 퀴즈를 통과한 분실자에게만 상세 위치가 공개됩니다</label>
            <div className="muted" style={{ fontSize: 13 }}>
              {quizRecommended ? '고가품이거나 특징이 있는 물건이라 퀴즈를 권장해요.' : '우산·텀블러처럼 흔한 물건은 퀴즈 없이 올려도 괜찮아요.'}
              {' '}퀴즈를 맞힌 사람만 수령 신청할 수 있어요. 정답은 공개되지 않아요.
              {form.use_quiz && ' 퀴즈 정답이 사진이나 설명에 드러나지 않았는지 꼭 확인해주세요. 퀴즈를 켜면 건물 이름만 공개되고, 상세 위치와 맡긴 곳은 퀴즈를 통과한 사람에게만 보여요. 경비실이나 과사무실처럼 사람이 있는 곳에 맡기는 걸 권장해요.'}
            </div>
            {form.use_quiz && (
              <div className="row">
                <label>질문<input maxLength={200} value={form.quiz_question} onChange={set('quiz_question')} placeholder="예: 케이스에 붙은 스티커 모양은?" /></label>
                <label>정답<input maxLength={100} value={form.quiz_answer} onChange={set('quiz_answer')}
                  placeholder={editing && item.quiz_question ? '비워 두면 기존 정답 유지' : '예: 고양이'} /></label>
              </div>
            )}
          </div>
        </section>

        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={close}>취소</button>
          <button className="primary" disabled={busy || ai.state === 'loading'}>{busy ? '저장 중…' : editing ? '수정 내용 저장' : '습득물 등록 완료'}</button>
        </div>
      </form>
    </div>
  );
}
