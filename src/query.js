import { normalize, validDate, setsOf } from './domain.js';

export function queryExercise(text) {
  if (/[\r\n]/.test(text.trim())) return null;
  const match = /^(.+?)(?:언제했어|기록조회)[?？.!]*$/.exec(normalize(text));
  return match ? match[1] : null;
}

export function formatExerciseDates(name, records) {
  const matched = records.filter(r => normalize(r.workout_type_name) === normalize(name));
  if (!matched.length) return `${name}\n해당 이름으로 등록된 운동 기록이 없습니다. 사이트의 운동 이름을 확인해주세요.`;
  const days = new Map();
  for (const record of matched) {
    const day = validDate(String(record.workout_date).slice(0, 10));
    const entry = days.get(day) ?? { sets: 0, records: 0 };
    entry.sets += record.sets == null ? 0 : setsOf(record).length;
    entry.records++;
    days.set(day, entry);
  }
  const sorted = [...days].sort(([a], [b]) => a < b ? 1 : a > b ? -1 : 0);
  const title = matched[0].workout_type_name;
  const lines = [`${title} 운동 날짜`, `총 ${days.size}일 · 최근 ${Math.min(days.size, 10)}일 표시`, ''];
  for (const [day, entry] of sorted.slice(0, 10)) {
    lines.push(`${day} · ${entry.sets ? `${entry.sets}세트` : `${entry.records}개 기록`}`);
  }
  lines.push('', '날짜를 보내면 그날의 상세 기록을 확인할 수 있습니다.');
  return lines.join('\n');
}

export function queryDate(text, now = new Date()) {
  // 여러 줄 등록 문장은 날짜 조회로 처리하지 않는다.
  if (/[\r\n]/.test(text.trim())) return null;
  let input = normalize(text);
  const explicit = input.endsWith('조회');
  if (explicit) input = input.slice(0, -2);
  if (input === '오늘' || input === '어제') {
    // 현재 한국 표준시는 UTC+9. 서버의 시간대 설정에 의존하지 않는다.
    const offset = 9 * 60 * 60 * 1000 - (input === '어제' ? 86400000 : 0);
    return new Date(now.getTime() + offset).toISOString().slice(0, 10);
  }
  input = input.replace(/^(\d{4})년(\d{1,2})월(\d{1,2})일$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return validDate(input);
  if (explicit) throw new Error('조회 예: 2026-10-22 조회 또는 오늘 조회');
  return null;
}

export function formatDailyRecords(day, records) {
  if (!records.length) return `${day}\n해당 날짜의 운동 기록이 없습니다.`;
  const lines = [`${day} 운동 기록`, `총 ${records.length}개 운동 기록`];
  records.forEach((r, index) => {
    lines.push('', `${index + 1}. ${r.workout_type_name || r.text_content || '이름 없는 운동'}`);
    const sets = r.sets == null ? [] : setsOf(r);
    for (const set of sets) lines.push(`   ${set.set_number}세트: ${set.weight ?? '—'}kg × ${set.reps ?? '—'}회`);
    const minutes = Number(r.duration_minutes) || 0, seconds = Number(r.duration_seconds) || 0;
    if (minutes || seconds) lines.push(`   시간: ${minutes}분 ${seconds}초`);
    if (r.notes) lines.push(`   메모: ${r.notes}`);
    if (!sets.length && !minutes && !seconds && !r.notes && !r.text_content) lines.push('   세부 기록 없음');
  });
  return lines.join('\n');
}

export function splitReply(text, limit = 3500) {
  const chunks = [];
  while (text.length > limit) {
    let end = text.lastIndexOf('\n', limit - 1) + 1;
    if (!end) end = limit;
    // 이모지 등 UTF-16 문자 쌍 중간에서 자르지 않는다.
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}
