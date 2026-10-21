export const normalize = value => String(value ?? '').replace(/\s+/gu, '').toLowerCase();

export function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!match || !Number(match[1]) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력하세요.');
  }
  return value;
}

export function parse(text) {
  const compact = normalize(text);
  if (/(수정|삭제)$/.test(compact)) return parseAction(compact);
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('첫 줄에 날짜, 다음 줄부터 운동을 입력하세요.');
  let day = normalize(lines.shift()).replace(/^날짜:/, '');
  day = day.replace(/^(\d{4})년(\d{1,2})월(\d{1,2})일$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  validDate(day);
  if (lines.length > 20) throw new Error('한 번에 운동 20개까지 입력하세요.');
  const workouts = lines.map(line => {
    const s = normalize(line.replace(/^\d+[.)]\s*/, ''));
    const first = /\d+(?:\.\d+)?(?:kg|키로)/.exec(s);
    if (!first || first.index === 0) throw new Error('예: 벤치프레스 30kg 10회 3세트');
    const name = s.slice(0, first.index);
    let weight;
    const sets = [];
    for (const part of s.slice(first.index).split(',')) {
      const m = /^(?:(\d+(?:\.\d+)?)(?:kg|키로)(?:으로)?)?(\d+)(?:회|개)(?:씩)?(\d+)세트$/.exec(part.replace(/^이후/, ''));
      if (!m) throw new Error(`${name}: 세트 입력을 확인하세요.`);
      if (m[1] !== undefined) weight = Number(m[1]);
      const reps = Number(m[2]), count = Number(m[3]);
      if (weight === undefined || !Number.isFinite(weight) || reps < 1 || reps > 1000 || count < 1 || count > 100 || sets.length + count > 100) throw new Error('무게·횟수·세트 수를 확인하세요.');
      for (let i = 0; i < count; i++) sets.push({ set_number: sets.length + 1, weight, reps });
    }
    return { name, sets };
  });
  return { mode: 'create', day, workouts };
}

function parseAction(s) {
  const head = /^(\d{4}-\d{2}-\d{2})(.+)$/.exec(s);
  if (!head) throw new Error('명령 앞에 YYYY-MM-DD 날짜를 넣으세요.');
  const day = validDate(head[1]), tail = head[2];
  if (tail.endsWith('전체삭제') && tail.length > 4) return { mode: 'delete', day, name: tail.slice(0, -4) };
  let m = /^(.+?)(\d+)(?:[~～-](\d+))?세트삭제$/.exec(tail);
  let result;
  if (m) result = { mode: 'remove', day, name: m[1], start: Number(m[2]), end: Number(m[3] ?? m[2]) };
  else {
    m = /^(.+?)(\d+)(?:[~～-](\d+))?세트(무게|횟수)(\d+(?:\.\d+)?)(kg|키로|회|개)(?:으로|로)?수정$/.exec(tail);
    if (!m) throw new Error('예: 2026-10-22 레그프레스 2~4세트 무게 120kg으로 수정');
    const field = m[4] === '무게' ? 'weight' : 'reps', value = Number(m[5]);
    if (!Number.isFinite(value) || (field === 'weight' ? !['kg', '키로'].includes(m[6]) : !['회', '개'].includes(m[6]) || !Number.isInteger(value) || value < 1 || value > 1000)) throw new Error('무게·횟수의 단위와 값을 확인하세요.');
    result = { mode: 'edit', day, name: m[1], start: Number(m[2]), end: Number(m[3] ?? m[2]), field, value };
  }
  if (result.start < 1 || result.end < result.start || result.end > 1000) throw new Error('세트 범위를 확인하세요.');
  return result;
}

export function setsOf(record) {
  const sets = typeof record.sets === 'string' ? JSON.parse(record.sets) : record.sets;
  if (!Array.isArray(sets)) throw new Error('기존 세트 정보를 확인하지 못했습니다.');
  return structuredClone(sets);
}

export function changeSets(record, command) {
  let sets = setsOf(record);
  const nums = sets.map(s => Number(s.set_number));
  if (new Set(nums).size !== nums.length) throw new Error('기존 세트 번호가 중복됩니다.');
  for (let n = command.start; n <= command.end; n++) if (!nums.includes(n)) throw new Error('존재하지 않는 세트입니다.');
  if (command.mode === 'remove') {
    sets = sets.filter(s => Number(s.set_number) < command.start || Number(s.set_number) > command.end);
    if (!sets.length) throw new Error('모든 세트는 전체 삭제 명령을 사용하세요.');
    sets.sort((a, b) => Number(a.set_number) - Number(b.set_number)).forEach((s, i) => { s.set_number = i + 1; });
  } else for (const s of sets) if (Number(s.set_number) >= command.start && Number(s.set_number) <= command.end) s[command.field] = command.value;
  return sets;
}

export function snapshot(r) {
  return JSON.stringify([r.id, r.workout_date, r.workout_type_id, r.notes ?? null, r.duration_minutes ?? null, r.duration_seconds ?? null,
    setsOf(r).map(s => [s.id ?? null, Number(s.set_number), s.weight, s.reps, s.is_completed ?? false])]);
}

export function describe(records) {
  return records.map(r => `${r.workout_date} ${r.name ?? r.workout_type_name}\n${setsOf(r).map(s => `${s.set_number}세트: ${s.weight}kg × ${s.reps}회`).join('\n')}`).join('\n\n');
}
