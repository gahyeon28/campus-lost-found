'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import { supabase, authedFetch } from '@/lib/supabase';
import { shrinkImage } from '@/lib/image';
import { CATEGORIES, COLORS, STORAGE_TYPES, QUIZ_RECOMMENDED } from '@/lib/constants';
import { BUILDINGS } from '@/lib/campus';

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false, loading: () => <p className="muted">지도 불러오는 중…</p> });

function localNow() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function NewItem() {
  const { user } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    title: '', category: '기타', color: '', brand: '', tags: '', description: '',
    found_at: '', building: '', location_detail: '', lat: null, lng: null,
    storage_type: STORAGE_TYPES[0], storage_detail: '', use_quiz: false, quiz_question: '', quiz_answer: '',
  });
  const [photo, setPhoto] = useState(null); // { blob, base64, preview }
  const [ai, setAi] = useState({ state: 'idle', msg: '', recommended: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setForm((f) => ({ ...f, found_at: localNow() })), []);

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
    if (form.use_quiz && (!form.quiz_question.trim() || !form.quiz_answer.trim())) return setError('퀴즈 질문과 정답을 모두 입력해주세요.');
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
      const { data: id, error: rpcErr } = await supabase().rpc('create_item', {
        p: payload,
        p_answer: form.use_quiz ? form.quiz_answer : null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      authedFetch('/api/notify', { itemId: id }).catch((err) => console.warn('알림 발송 실패', err));
      router.push(`/items/${id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <h2>📦 습득물 등록</h2>
      <p className="muted">주운 물건을 그 자리에 두었거나 근처 공용 장소에 맡겼다면 위치를 남겨주세요.</p>
      <form onSubmit={submit} className="card">
        <label>
          사진 (권장 · 학생증·카드 번호가 보이지 않게 찍어주세요)
          <input type="file" accept="image/*" onChange={onPhoto} />
        </label>
        {photo && <img src={photo.preview} alt="미리보기" style={{ maxWidth: 260, borderRadius: 12 }} />}
        {ai.msg && <div className={`box ${ai.state === 'error' ? 'red' : 'purple'}`}>{ai.msg}</div>}

        <div className="row">
          <label>물건 이름 *<input required maxLength={60} value={form.title} onChange={set('title')} placeholder="예: 흰색 에어팟 프로" /></label>
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

        <label>습득 날짜·시간 *
          <input type="datetime-local" required max={localNow()} value={form.found_at} onChange={set('found_at')} />
        </label>

        <div className="stack">
          <b style={{ fontSize: 14 }}>발견 위치 * <span className="muted">— 건물 점을 누르거나, 정확한 위치를 지도에서 누르세요</span></b>
          <MapPicker value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          <div className="row">
            <label>건물
              <select value={form.building} onChange={(e) => {
                const b = BUILDINGS.find((x) => x.name === e.target.value);
                setForm({ ...form, building: e.target.value, lat: b?.lat ?? null, lng: b?.lng ?? null });
              }}>
                <option value="">선택하세요</option>
                {BUILDINGS.map((b) => <option key={b.name}>{b.name}</option>)}
              </select>
            </label>
            <label>상세 위치<input maxLength={200} value={form.location_detail} onChange={set('location_detail')} placeholder="예: 3층 열람실 창가 자리" /></label>
          </div>
        </div>

        <div className="stack">
          <b style={{ fontSize: 14 }}>물건을 어디에 두었나요? *</b>
          {STORAGE_TYPES.map((t) => (
            <label key={t} className="check">
              <input type="radio" name="storage_type" checked={form.storage_type === t} onChange={() => setForm({ ...form, storage_type: t })} /> {t}
            </label>
          ))}
          <input maxLength={200} value={form.storage_detail} onChange={set('storage_detail')}
            placeholder={form.storage_type === STORAGE_TYPES[1] ? '맡긴 곳 (예: 3층 안내데스크, 1층 경비실)' : '추가 설명 (예: 책상 위에 그대로 둠)'} />
        </div>

        <div className={`box ${quizRecommended ? 'purple' : 'green'}`}>
          <label className="check"><input type="checkbox" checked={form.use_quiz} onChange={set('use_quiz')} /> 🔐 본인 확인 퀴즈 사용 (선택)</label>
          <div className="muted" style={{ marginTop: 4 }}>
            {quizRecommended ? '고가품이거나 특징이 있는 물건이라 퀴즈를 권장해요.' : '우산·텀블러처럼 흔한 물건은 퀴즈 없이 올려도 괜찮아요.'}
            {' '}퀴즈를 맞힌 사람만 수령 신청할 수 있어요. 정답은 공개되지 않아요.
          </div>
          {form.use_quiz && (
            <div className="row" style={{ marginTop: 10 }}>
              <label>질문<input maxLength={200} value={form.quiz_question} onChange={set('quiz_question')} placeholder="예: 케이스에 붙은 스티커 모양은?" /></label>
              <label>정답<input maxLength={100} value={form.quiz_answer} onChange={set('quiz_answer')} placeholder="예: 고양이" /></label>
            </div>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || ai.state === 'loading'}>{busy ? '등록 중…' : '습득물 등록하기'}</button>
      </form>
    </>
  );
}

export default function Page() {
  return <RequireAuth><NewItem /></RequireAuth>;
}
