/** E8 فقط: defense يصل لتاريخ البحث — node --env-file=.env scripts/acceptance-e8.mjs */
import { pool } from '../src/db/client.js';
import { askSupervisor, getConversation } from '../src/services/chat.js';
import { saveUpload } from '../src/services/files.js';
import { setStepStatus } from '../src/services/journey.js';
import { startDefense } from '../src/services/defense.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function dask(uid, profile, prompt, convId, fileIds = []) {
  let last;
  for (let a = 1; a <= 3; a += 1) {
    try { return await askSupervisor({ userId: uid, prompt, profile, conversationId: convId, mode: 'defense', fileIds }); }
    catch (e) { last = e; console.log(`  retry ${a} (${e.code || e.message})`); await sleep(3000); }
  }
  throw last;
}
async function main() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_used, tokens_granted, onboarding_complete, is_active, plan_code) VALUES ($1,'باحث E8',$2,'researcher',80000,0,80000,true,true,'thesis') RETURNING id`,
    [`e8.${stamp}@example.com`, `e8-${stamp}`]);
  const uid = rows[0].id;
  const profile = { full_name: 'باحث E8', degree_level: 'master', research_field: 'إدارة الأعمال', research_title: 'أثر التسويق الرقمي على مبيعات المتاجر الصغيرة', research_stage: 'defense', preferred_language: 'ar', citation_style: 'apa7', university: 'جامعة الاختبار', faculty: 'كلية الإدارة', about: 'الهدف الحالي: الاستعداد للمناقشة | حالة المشروع: يستعد للمناقشة' };
  await pool.query(`INSERT INTO profiles (user_id, full_name, degree_level, research_field, research_title, research_stage, preferred_language, citation_style, university, faculty, about) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id) DO NOTHING`,
    [uid, profile.full_name, profile.degree_level, profile.research_field, profile.research_title, profile.research_stage, profile.preferred_language, profile.citation_style, profile.university, profile.faculty, profile.about]);
  for (const k of ['topic', 'proposal', 'literature', 'methodology', 'writing']) await setStepStatus(uid, k, { status: 'done', outputNote: 'مكتمل (إعداد اختبار)' }).catch(() => {});
  try {
    const buf = Buffer.from('الفصل الأول: مشكلة ضعف مبيعات المتاجر الصغيرة في العاصمة. المنهج وصفي تحليلي. العينة 200 متجر. النتائج أظهرت ارتفاع المبيعات 35 بالمئة.', 'utf8');
    const f = await saveUpload(uid, { file: { name: 'الفصل-الأول.txt', size: buf.length, type: 'text/plain', arrayBuffer: async () => buf }, title: 'الفصل الأول', step: 'writing' });
    const dconv = await startDefense({ userId: uid, title: 'مناقشة E8' });
    const r = await dask(uid, profile, 'ما المنهج الذي استخدمته في بحثك ولماذا اخترته؟ أجب استناداً إلى بحثي المرفق.', dconv.id, [f.id]);
    console.log('ANSWER_LEN=' + r.answer.length);
    console.log(r.answer.slice(0, 600));
    const hits = [/200/.test(r.answer), /35/.test(r.answer), /التسويق/.test(r.answer), /المتاجر/.test(r.answer), /وصفي/.test(r.answer)];
    console.log('HITS_200_35_TASWIQ_MATAJIR_WASFI=' + hits.map((h) => (h ? 1 : 0)).join(''));
    const g = await getConversation(uid, dconv.id);
    console.log('ASKED=' + (g.defense_state?.asked ?? '?'));
    const ok = hits.filter(Boolean).length >= 2 && !/لا يمكنني تقديم البحث كاملاً/.test(r.answer);
    console.log(ok ? '✅ E8 وصول المناقشة لتاريخ البحث' : '❌ E8 لم يصل لتاريخ البحث');
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.query('DELETE FROM usage_logs WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM conversations WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM supervisor_memory WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM files WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM user_step_progress WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await pool.end().catch(() => {});
  }
}
main().catch(async (e) => { console.error('FATAL:', e.message); await pool.end().catch(() => {}); process.exit(1); });
