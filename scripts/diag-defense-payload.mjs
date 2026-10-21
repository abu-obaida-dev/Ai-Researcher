/**
 * سكربت تشخيص: يقيس أحجام حمولة وضع المناقشة (defense) فعلياً.
 * الغرض: إثبات ما إذا كانت ميزانية Groq (4000 token) تكفي لموجّه المناقِش
 * + نصّ الملف + سجلّ الجلسة، وماذا يفعل التقصير بجلسته تحديداً.
 */
import { buildDefensePrompt } from '../src/services/supervisor-prompt.js';
import {
  CHARS_PER_TOKEN,
  MODEL_INPUT_BUDGETS,
  budgetForModel,
  measurePayloadTokens,
  trimPayloadToBudget
} from '../src/services/payload-budget.js';

const ctx = {
  userName: 'الباحث',
  degree: 'ماجستير',
  field: 'إدارة الأعمال',
  title: 'دور إدارة الموارد البشرية في التطوير التنظيمي',
  university: 'جامعة',
  language: 'العربية',
  mode: 'defense',
  files: '',
  fileNames: [],
  filesUnreadable: [],
  replyCap: 1400
};

const systemOnly = buildDefensePrompt(ctx);
console.log('=== موجّه المناقِش وحده (بلا ملف) ===');
console.log('chars:', systemOnly.length, 'tokens:', Math.ceil(systemOnly.length / CHARS_PER_TOKEN));

const fileText = 'ماجستير-معدل.pdf\n' + 'ا'.repeat(6000);
const filesBlock = `<files>\n<file name="ماجستير-معدل.pdf">\n${fileText}\n</file>\n</files>`;
const system = `${systemOnly}\n\n${filesBlock}`;

const history = [
  { role: 'system', content: '📎 ثُبِّت ملف البحث «ماجستير-معدل.pdf» في هذه الجلسة.' },
  { role: 'assistant', content: 'سؤال المناقش الأول: ما معاملات الانحدار ومستوى الدلالة؟ '.repeat(20) },
  { role: 'user', content: 'إجابة الباحث الطويلة: 1. حجم العينة ونطاقها ... '.repeat(60) },
  { role: 'assistant', content: 'تقييم المناقش + سؤاله التالي: '.repeat(20) },
  { role: 'user', content: 'إجابة الباحث الثانية: القيود ... '.repeat(60) }
];
const question = 'في ملف ماجستير-معدل.pdf، كيف تم اختيار المتغيرات المستقلة؟';

const messages = [...history, { role: 'user', content: question }];

console.log('\n=== الحمولة الكاملة ===');
console.log('tokens total:', measurePayloadTokens(system, messages));
console.log('tokens system:', Math.ceil(system.length / CHARS_PER_TOKEN));
console.log('tokens messages:', measurePayloadTokens({}, messages));

for (const [model, budget] of Object.entries(MODEL_INPUT_BUDGETS)) {
  console.log(`\n=== ميزانية ${model} = ${budget} ===`);
  const result = trimPayloadToBudget(system, messages, budget);
  console.log('after trim tokens:', result.tokens, 'trimmed:', result.trimmed, 'fileChars:', result.fileChars);
  console.log('messages left:', result.messages.length, 'roles:', result.messages.map((m) => m.role).join(','));
  const kept = result.messages.map((m) => `${m.role}:${String(m.content || '').length}`).join(' | ');
  console.log('kept sizes:', kept);
  const lastUser = [...result.messages].reverse().find((m) => m.role === 'user');
  console.log('last user content length:', lastUser ? String(lastUser.content).length : 'NONE');
}

console.log('\n=== budgetForModel ===');
for (const m of Object.keys(MODEL_INPUT_BUDGETS)) console.log(m, '=>', budgetForModel(m, 'groq'));
