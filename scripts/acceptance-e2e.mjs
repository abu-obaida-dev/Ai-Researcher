/** E2E رحلة كاملة: topic→مراجع→منهجية→كتابة→مراجعة→مناقشة — باحث واحد — node --env-file=.env scripts/acceptance-e2e.mjs */
import { pool } from '../src/db/client.js';
import { askSupervisor, createConversation, getConversation } from '../src/services/chat.js';
import { saveUpload } from '../src/services/files.js';
import { getJourney, setStepStatus } from '../src/services/journey.js';
import { getMemory, summarizeConversation } from '../src/services/supervisor-memory.js';
import { detectStepCompletion, saveStepReview } from '../src/services/step-review.js';
import { defenseProgress, startDefense } from '../src/services/defense.js';
import { getProfile } from '../src/services/users.js';
import fs from 'node:fs';
const results = []; const stats = { liveCalls: 0, violations: 0 }; const full = {}; const ctx = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(id, name, ok, extra = '') {
  results.push({ id, name, ok: !!ok });
  console.log(`${ok ? '✅' : '❌'} ${id} ${name}${extra ? ` — ${String(extra).slice(0, 100)}` : ''}`);
  if (!ok) stats.violations += 1;
}
const countQ = (t) => (String(t || '').match(/[؟?]/g) || []).length;
async function eask(uid, profile, prompt, opts = {}) {
  let last;
  for (let a = 1; a <= 3; a += 1) {
    try {
      const r = await askSupervisor({ userId: uid, prompt, profile, conversationId: opts.conversationId || null, stepKey: opts.stepKey || '', mode: opts.mode || 'normal', fileIds: opts.fileIds || [] });
      stats.liveCalls += 1; return r;
    } catch (e) { last = e; console.log(`  retry ${a} (${e.code || e.message})`); await sleep(3000); }
  }
  throw last;
}

async function runA(uid, profile) {
  let r = await eask(uid, profile, 'مرحبا، أريد البدء في بحثي.');
  full['E1-hello'] = r.answer; ctx.convTopic = r.conversationId;
  check('E1', 'الترحيب يستخدم الملف + سؤال واحد', /ماجستير|إدارة الأعمال/.test(r.answer) && countQ(r.answer) <= 1, r.answer.slice(0, 80));
  r = await eask(uid, profile, 'موضوعي: أثر التسويق الرقمي على مبيعات المتاجر الصغيرة في العاصمة.', { conversationId: ctx.convTopic });
  full['E2-topic'] = r.answer;
  const j1 = await getJourney(uid, 'master');
  check('E2', 'الموضوع سُجل حرفياً في المسار', (j1.steps.find((s) => s.key === 'topic')?.outputNote || '').includes('التسويق الرقمي'), 'recorded');
  profile.research_title = 'أثر التسويق الرقمي على مبيعات المتاجر الصغيرة في العاصمة';
  r = await eask(uid, profile, 'صياغة المشكلة: ضعف مبيعات المتاجر الصغيرة. حدود الدراسة: العاصمة خلال 2024. عنوان البحث: موضوعي عن التسويق الرقمي والمبيعات.', { conversationId: ctx.convTopic });
  full['E3-bounds'] = r.answer;
  const conv = await getConversation(uid, ctx.convTopic);
  const card = await detectStepCompletion({ userId: uid, conversation: { ...conv, step_key: 'topic', mode: 'normal', pending_review: conv.pending_review || null } });
  check('E3', 'بطاقة topic ظهرت', !!card, card ? `fields=${card.fields.length}` : 'no-card');
  if (card) {
    const vals = Object.fromEntries(card.fields.map((f) => [f.key, f.value || 'قيمة رحلة']));
    await saveStepReview(uid, ctx.convTopic, vals);
    const j2 = await getJourney(uid, 'master');
    check('E3', 'الحفظ رقّى المسار (topic تم)', j2.steps.find((s) => s.key === 'topic')?.status === 'done', `current=${j2.current?.title}`);
  }
}
async function runB(uid, profile) {
  const convLit = await createConversation(uid, { title: 'مراجع', stepKey: 'literature' });
  let r = await eask(uid, profile, 'أعطني مراجع عن أثر التسويق الرقمي على المبيعات', { conversationId: convLit.id, stepKey: 'literature' });
  full['E4-refs'] = r.answer;
  check('E4', 'المراجع تعمل بعد اكتمال topic', /(https?:\/\/|doi\.org)/i.test(r.answer) || /مرجع|العنوان/.test(r.answer), r.answer.slice(0, 90));
  const mem1 = await getMemory(uid);
  check('E4', 'المهمة التالية محفوظة (انتقال السياق)', (mem1.openTask || '').length > 0, (mem1.openTask || '').slice(0, 60));
  const convMet = await createConversation(uid, { title: 'منهجية', stepKey: 'methodology' });
  r = await eask(uid, profile, 'ما المنهج المناسب لدراسة أثر التسويق الرقمي على المبيعات؟ عينتي 200 متجر.', { conversationId: convMet.id, stepKey: 'methodology' });
  full['E5-meth'] = r.answer;
  check('E5', 'نقاش ملاءمة المنهج والعينة بسؤال', /المنهج|العينة|200/.test(r.answer) && countQ(r.answer) >= 1, r.answer.slice(0, 90));
  const buf = Buffer.from('الفصل الأول: مشكلة ضعف مبيعات المتاجر الصغيرة في العاصمة. المنهج وصفي تحليلي. العينة 200 متجر. النتائج أظهرت ارتفاع المبيعات 35 بالمئة.', 'utf8');
  const f = await saveUpload(uid, { file: { name: 'الفصل-الأول.txt', size: buf.length, type: 'text/plain', arrayBuffer: async () => buf }, title: 'الفصل الأول', step: 'writing' });
  ctx.fileId = f.id;
  const convWr = await createConversation(uid, { title: 'كتابة', stepKey: 'writing' });
  r = await eask(uid, profile, 'راجع هذا الفصل وأخبرني رأيك.', { conversationId: convWr.id, stepKey: 'writing', fileIds: [f.id] });
  full['E6-review'] = r.answer;
  check('E6', 'المراجعة من الملف + تصنيف بلا كتابة', /الفصل|منهج|الأدلة|الصياغة/.test(r.answer) && !/(?:إليك|فيما يلي)[^.؟\n]{0,30}(?:الفصل|النسخة النهائية)/.test(r.answer), r.answer.slice(0, 90));
  const g = await getConversation(uid, convWr.id);
  if ((g.messages || []).length >= 4) { await summarizeConversation(uid, { messages: g.messages, profile }); }
  const mem2 = await getMemory(uid);
  check('E7', 'الذاكرة محفوظة بين الجلسات', ((mem2.memory || '') + (mem2.openTask || '')).length > 0, ((mem2.memory || '') + (mem2.openTask || '')).slice(0, 60));
  const dconv = await startDefense({ userId: uid, title: 'مناقشة الرحلة' });
  r = await eask(uid, profile, 'قدّم بحثك: مشكلتي ضعف المبيعات، منهجي وصفي تحليلي على 200 متجر، نتيجتي ارتفاع 35 بالمئة.', { conversationId: dconv.id, mode: 'defense', fileIds: [f.id] });
  full['E8-defense'] = r.answer;
  const gd = await getConversation(uid, dconv.id);
  check('E8', 'المناقشة تصل لتاريخ البحث (200/35%)', /200|35|التسويق|المتاجر/.test(r.answer), r.answer.slice(0, 90));
  check('E8', 'عداد المناقشة يعمل', (Number(gd.defense_state?.asked) || 0) >= 1, `asked=${gd.defense_state?.asked}`);
  const jf = await getJourney(uid, 'master');
  check('E9', 'المسار تراكمي: topic تم', jf.steps.find((s) => s.key === 'topic')?.status === 'done', `current=${jf.current?.title}`);
}
async function main() {
  const t0 = Date.now();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_used, tokens_granted, onboarding_complete, is_active, plan_code) VALUES ($1,'باحث الرحلة',$2,'researcher',150000,0,150000,true,true,'thesis') RETURNING id`,
    [`e2e.${stamp}@example.com`, `e2e-${stamp}`]);
  const uid = rows[0].id;
  const profile = { full_name: 'باحث الرحلة', degree_level: 'master', research_field: 'إدارة الأعمال', research_title: '', research_stage: 'topic', preferred_language: 'ar', citation_style: 'apa7', university: 'جامعة الاختبار', faculty: 'كلية الإدارة', about: 'الهدف الحالي: اختيار فكرة أو موضوع البحث | حالة المشروع: في البداية' };
  await pool.query(`INSERT INTO profiles (user_id, full_name, degree_level, research_field, research_title, research_stage, preferred_language, citation_style, university, faculty, about) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id) DO NOTHING`,
    [uid, profile.full_name, profile.degree_level, profile.research_field, profile.research_title, profile.research_stage, profile.preferred_language, profile.citation_style, profile.university, profile.faculty, profile.about]);
  try {
    await runA(uid, profile);
    profile.research_title = 'أثر التسويق الرقمي على مبيعات المتاجر الصغيرة في العاصمة';
    await runB(uid, profile);
  } finally {
    await pool.query('DELETE FROM usage_logs WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM conversations WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM supervisor_memory WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM files WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM user_step_progress WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
  }
  const pass = results.filter((x) => x.ok).length;
  console.log(`\nالملخص E2E: ${pass}/${results.length} ناجح | انتهاكات=${stats.violations} | نداءات حية=${stats.liveCalls} | زمن=${Math.round((Date.now() - t0) / 1000)}ث`);
  fs.writeFileSync('/tmp/at-e2e-full.json', JSON.stringify(full, null, 2));
  await pool.end().catch(() => {});
  if (pass !== results.length) process.exitCode = 1;
}
main().catch(async (e) => { console.error('FATAL:', e.message); await pool.end().catch(() => {}); process.exit(1); });