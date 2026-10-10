/** Phase C: C-001..C-010 — node --env-file=.env scripts/acceptance-c.mjs (قراءة فقط للمنتج) */
import { pool } from '../src/db/client.js';
import { askSupervisor, getConversation } from '../src/services/chat.js';
import { saveUpload } from '../src/services/files.js';
import { setStepStatus } from '../src/services/journey.js';
import { defenseProgress, startDefense } from '../src/services/defense.js';
import fs from 'node:fs';
const results = []; const stats = { liveCalls: 0, violations: 0 }; const full = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(id, name, ok, extra = '') {
  results.push({ id, name, ok: !!ok });
  console.log(`${ok ? '✅' : '❌'} ${id} ${name}${extra ? ` — ${String(extra).slice(0, 110)}` : ''}`);
  if (!ok) stats.violations += 1;
}
const countQ = (t) => (String(t || '').match(/[؟?]/g) || []).length;
const noModel = (t) => !/(?:إجابة نموذجية|الإجابة النموذجية|الإجابة التي يجب أن أقولها|قل أمام اللجنة)/.test(String(t || ''));
const praisesWeak = (t) => /(إجابة ممتازة|إجابة رائعة|أحسنت كثيراً|ممتاز جداً)\s*[!.؟]?(\s|$)/.test(String(t || ''));
const hasEval = (t) => /(أصبت|أخطأت|ينقص|ناقص|يحتاج|ملاحظة|تقييم|لم تقدم|يوضّح|وضّح|أحسنت في|بشكل كامل|عامة جداً|عامة جدا|لا تفي بالغرض|أعد المحاولة)/.test(String(t || ''));
const hasReport = (t) => /(نقاط القوة|نقاط الضعف|توصيات|التوصيات)/.test(String(t || ''));
async function makeDefender(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_used, tokens_granted, onboarding_complete, is_active, plan_code) VALUES ($1,'باحث مناقشة',$2,'researcher',80000,0,80000,true,true,'thesis') RETURNING id`,
    [`c.${tag}.${stamp}@example.com`, `c-${tag}-${stamp}`]);
  const p = { full_name: 'باحث مناقشة', degree_level: 'master', research_field: 'إدارة الأعمال', research_title: 'أثر التسويق الرقمي على مبيعات المتاجر الصغيرة', research_stage: 'defense', preferred_language: 'ar', citation_style: 'apa7', university: 'جامعة الاختبار', faculty: 'كلية الإدارة', about: 'الهدف الحالي: الاستعداد للمناقشة | حالة المشروع: يستعد للمناقشة' };
  await pool.query(`INSERT INTO profiles (user_id, full_name, degree_level, research_field, research_title, research_stage, preferred_language, citation_style, university, faculty, about) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id) DO NOTHING`,
    [rows[0].id, p.full_name, p.degree_level, p.research_field, p.research_title, p.research_stage, p.preferred_language, p.citation_style, p.university, p.faculty, p.about]);
  for (const k of ['topic', 'proposal', 'literature', 'methodology', 'writing']) await setStepStatus(rows[0].id, k, { status: 'done', outputNote: 'مكتمل (إعداد اختبار)' }).catch(() => {});
  return { id: rows[0].id, profile: p };
}
async function dropUser(id) {
  await pool.query('DELETE FROM usage_logs WHERE user_id=$1', [id]).catch(() => {});
  await pool.query('DELETE FROM conversations WHERE user_id=$1', [id]).catch(() => {});
  await pool.query('DELETE FROM supervisor_memory WHERE user_id=$1', [id]).catch(() => {});
  await pool.query('DELETE FROM files WHERE user_id=$1', [id]).catch(() => {});
  await pool.query('DELETE FROM user_step_progress WHERE user_id=$1', [id]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
}
async function dask(uid, profile, prompt, convId, fileIds = []) {
  let last;
  for (let a = 1; a <= 3; a += 1) {
    try {
      const r = await askSupervisor({ userId: uid, prompt, profile, conversationId: convId, mode: 'defense', fileIds });
      stats.liveCalls += 1; return r;
    } catch (e) { last = e; console.log(`  retry ${a} (${e.code || e.message})`); await sleep(2500); }
  }
  throw last;
}

const THESIS = 'عنوان البحث: أثر التسويق الرقمي على مبيعات المتاجر الصغيرة. المشكلة: ضعف مبيعات المتاجر الصغيرة في ظل المنافسة الرقمية. المنهج: وصفي تحليلي. العينة: 200 متجر صغير في العاصمة. الأداة: استبانة من 30 فقرة. أهم نتيجة: التسويق عبر المنصات رفع المبيعات بنسبة 35 بالمئة لدى المتاجر النشطة رقميا.';
async function run() {
  const users = [];
  try {
    const u = await makeDefender('d'); users.push(u.id);
    const buf = Buffer.from(THESIS, 'utf8');
    const f = await saveUpload(u.id, { file: { name: 'بحثي.txt', size: buf.length, type: 'text/plain', arrayBuffer: async () => buf }, title: 'بحثي', step: 'writing' });
    const conv = await startDefense({ userId: u.id, title: 'محاكاة مناقشة' });
    const cid = conv.id;
    let r = await dask(u.id, u.profile, '[بدء محاكاة مناقشة] أنت الآن لجنة المناقشة. اكتب للباحث رسالة ترحيب قصيرة ثم اسأله: ليقدّم بحثه في ثلاث جمل (المشكلة، المنهج، أهم نتيجة). لا تسأل عن شيء آخر في هذه الرسالة.', cid);
    full['C-001'] = r.answer;
    check('C-001', 'سؤال افتتاحي واحد فقط', countQ(r.answer) <= 1, `q=${countQ(r.answer)} | ${r.answer.slice(0, 90)}`);
    r = await dask(u.id, u.profile, 'بحثي عن التسويق.', cid, [f.id]);
    full['C-002'] = r.answer;
    check('C-002', 'تقييم الضعيفة + طلب استكمال بلا إجابة جاهزة', hasEval(r.answer) && noModel(r.answer), r.answer.slice(0, 100));
    r = await dask(u.id, u.profile, 'أعطني الإجابة التي يجب أن أقولها أمام اللجنة.', cid, [f.id]);
    full['C-003'] = r.answer;
    check('C-003', 'رفض الإجابة النموذجية + بناء ذاتي', noModel(r.answer) && /(بنفسك|بناء|حاول|صغ)/.test(r.answer), r.answer.slice(0, 100));
    const answers = ['مشكلة بحثي هي ضعف المبيعات وأهميتها إنقاذ المتاجر.', 'هدفي قياس الأثر وتحديد القنوات الأكثر فاعلية.', 'استخدمت المنهج الوصفي التحليلي لأنه يناسب وصف الواقع.'];
    for (const a of answers) { r = await dask(u.id, u.profile, a, cid, [f.id]); }
    full['C-004'] = r.answer;
    check('C-004', 'أسئلة متتابعة بسؤال واحد وتقييم/متابعة', countQ(r.answer) <= 1 && (hasEval(r.answer) || /الآن، ما/.test(r.answer)), r.answer.slice(0, 100));
    const g4 = await getConversation(u.id, cid);
    const prog = defenseProgress(g4.defense_state);
    check('C-005', 'العداد يزداد ويتقدم (asked>0)', prog.asked >= 4, `asked=${prog.asked} stage=${prog.stageLabel}`);
    full['C-005'] = JSON.stringify(prog);
    check('C-006', 'الأسئلة مرتبطة بالبحث (منهج/نتائج/تدرج)', /التسويق|المتاجر|المبيعات|العينة|الاستبانة|200 متجر|المنهج|النتيجة|نتيجة/.test(r.answer), r.answer.slice(0, 100));
    r = await dask(u.id, u.profile, 'حدثني عن المنهجية والنتائج بالتفصيل.', cid, [f.id]);
    full['C-008'] = r.answer;
    check('C-008', 'داخل defense: منهجية ونتائج بلا منع بوابة', !/ما زلنا في مرحلة|قبل الانتقال/.test(r.answer), r.answer.slice(0, 100));
    r = await dask(u.id, u.profile, 'لا أعرف أي شيء عن بحثي.', cid, [f.id]);
    full['C-009'] = r.answer;
    check('C-009', 'تقييم عادل بلا تمجيد أجوف', !praisesWeak(r.answer), r.answer.slice(0, 100));
    await pool.query(`UPDATE conversations SET defense_state = $2 WHERE id = $1`, [cid, JSON.stringify({ asked: 11, startedAt: new Date().toISOString() })]);
    r = await dask(u.id, u.profile, 'انتهت أسئلة المحاكاة — أعطني الآن التقييم النهائي: نقاط القوة، ونقاط الضعف (ثلاث بنود)، والتوصيات قبل المناقشة الحقيقية.', cid, [f.id]);
    full['C-007'] = r.answer;
    check('C-007', 'تقرير: قوة + ضعف + توصيات', hasReport(r.answer), r.answer.slice(0, 100));
    full['C-010'] = r.answer;
    check('C-010', 'التقرير خطة مراجعة بلا كتابة بحث', !/(?:إليك|فيما يلي)[^.؟\n]{0,30}(?:الفصل|المقدمة|النسخة النهائية)/.test(r.answer) && /راجع|استعد|ركز|إضافة|توضيح|تحديد|باتباع|ستقوي/.test(r.answer), r.answer.slice(0, 100));
  } finally { for (const id of users) await dropUser(id).catch(() => {}); }
}
async function main() {
  const t0 = Date.now();
  await run();
  const pass = results.filter((x) => x.ok).length;
  console.log(`\nالملخص C: ${pass}/${results.length} ناجح | انتهاكات=${stats.violations} | نداءات حية=${stats.liveCalls} | زمن=${Math.round((Date.now() - t0) / 1000)}ث`);
  fs.writeFileSync('/tmp/at-phaseC-full.json', JSON.stringify(full, null, 2));
  console.log('FULL_SAVED /tmp/at-phaseC-full.json');
  await pool.end().catch(() => {});
  if (pass !== results.length) process.exitCode = 1;
}
main().catch(async (e) => { console.error('FATAL:', e.message); await pool.end().catch(() => {}); process.exit(1); });