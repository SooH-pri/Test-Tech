import { parse, normalize, changeSets, snapshot, describe } from './domain.js';

const ORIGIN = 'https://goodlift.onrender.com';
class UserError extends Error {}

async function diagnostic(stage, operation) {
  try { return await operation(); }
  catch (error) {
    // URL·응답 본문·원본 오류에는 비밀 값이 있을 수 있어 출력하지 않는다.
    const safe = new Error('Operation failed');
    safe.safeStage = error.safeStage ?? stage;
    safe.safeStatus = Number.isInteger(error.safeStatus) ? error.safeStatus : undefined;
    safe.safeReason = /no such table/i.test(String(error.message)) ? 'missing_table'
      : /not authorized|unauthorized/i.test(String(error.message)) ? 'authorization'
      : error.name === 'TimeoutError' ? 'timeout' : 'operation_failed';
    throw safe;
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    const error = new Error('upstream');
    error.safeStatus = response.status;
    throw error;
  }
  return response.json();
}

export async function tg(env, method, data) {
  return diagnostic(`telegram.${method}`, async () => {
  const result = await jsonFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!result.ok) {
    const error = new Error('telegram');
    error.safeStatus = result.error_code;
    throw error;
  }
  return result.result;
  });
}
const send = (env, text, buttons) => tg(env, 'sendMessage', {
  chat_id: env.TELEGRAM_CHAT_ID, text,
  ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
});

async function login(env) {
  const response = await fetch(`${ORIGIN}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.GOODLIFT_USERNAME, password: env.GOODLIFT_PASSWORD }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('login');
  const user = await response.json();
  if (user.userType !== 'app_user' || !user.id) throw new Error('login');
  // 로그인 쿠키가 발급되면 GoodLift 요청에만 전달한다.
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const cookie = cookies.map(s => s.split(';')[0]).join('; ');
  return { id: user.id, cookie };
}

async function api(user, path, method = 'GET', body) {
  return jsonFetch(`${ORIGIN}/api${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user.cookie ? { Cookie: user.cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function list(user, day) {
  const result = await api(user, `/workout-records?${new URLSearchParams({ app_user_id: user.id, start_date: day, end_date: day })}`);
  if (!Array.isArray(result)) throw new Error('records');
  return result.filter(r => String(r.workout_date).slice(0, 10) === day);
}

async function prepare(env, text) {
  let command;
  try { command = parse(text); } catch (e) { throw new UserError(e.message); }
  const user = await login(env);
  if (command.mode === 'create') {
    const types = await api(user, '/workout-types');
    if (!Array.isArray(types)) throw new Error('catalog');
    const records = command.workouts.map(w => {
      const matches = types.filter(t => normalize(t.name) === normalize(w.name));
      if (matches.length !== 1) throw new UserError(`${w.name}: 일치하는 운동이 ${matches.length}개입니다. 이름을 확인하세요.`);
      if (matches[0].type !== '세트') throw new UserError(`${matches[0].name}: 지금은 세트 운동만 지원합니다.`);
      return { name: matches[0].name, workout_type_id: matches[0].id, workout_date: command.day, sets: w.sets, notes: null, duration_minutes: null, duration_seconds: null };
    });
    return { mode: 'create', owner: user.id, records, preview: `등록 확인\n\n${describe(records)}` };
  }
  const matches = (await list(user, command.day)).filter(r => normalize(r.workout_type_name) === normalize(command.name));
  if (matches.length !== 1) throw new UserError(`해당 운동 기록이 ${matches.length}개입니다. 정확히 하나일 때만 처리할 수 있습니다.`);
  const record = matches[0];
  let after;
  try { if (command.mode !== 'delete') after = changeSets(record, command); }
  catch (e) { throw new UserError(e.message); }
  return {
    mode: command.mode, owner: user.id, record, after,
    preview: command.mode === 'delete'
      ? `전체 삭제 확인\n\n${describe([record])}\n\n위 운동 기록 전체를 삭제합니다.`
      : `수정 확인\n\n[변경 전]\n${describe([record])}\n\n[변경 후]\n${describe([{ ...record, sets: after }])}`,
  };
}

async function execute(env, p) {
  const user = await login(env);
  if (user.id !== p.owner) throw new UserError('로그인 계정이 바뀌었습니다. 명령을 다시 보내세요.');
  if (p.mode === 'create') {
    const records = p.records.map(({ name, ...r }) => r);
    // 명시적인 사용자의 재등록은 허용한다. 같은 운동 내용의 중복 검사는 하지 않는다.
    await api(user, '/workout-records/batch', 'POST', { app_user_id: user.id, actor_app_user_id: user.id, workout_records: records });
    return;
  }
  const record = p.record;
  const current = (await list(user, String(record.workout_date).slice(0, 10))).find(r => r.id === record.id);
  if (!current || snapshot(current) !== snapshot(record)) throw new UserError('기록이 변경되거나 삭제됐습니다. 명령을 다시 보내세요.');
  if (p.mode === 'delete') {
    const response = await fetch(`${ORIGIN}/api/workout-records/${encodeURIComponent(record.id)}?${new URLSearchParams({ app_user_id: user.id })}`, {
      method: 'DELETE', headers: user.cookie ? { Cookie: user.cookie } : {}, signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('delete');
  } else {
    await api(user, `/workout-records/${encodeURIComponent(record.id)}`, 'PATCH', {
      app_user_id: user.id, workout_date: String(record.workout_date).slice(0, 10), workout_type_id: record.workout_type_id,
      notes: record.notes ?? null, duration_minutes: record.duration_minutes ?? null, duration_seconds: record.duration_seconds ?? null, sets: p.after,
    });
  }
}

async function history(env, mode, status, payload) {
  // 비밀번호·토큰·로그인 응답은 저장하지 않는다.
  const result = await env.DB.prepare('INSERT INTO history(action,status,details) VALUES(?,?,?)').bind(mode, status, JSON.stringify(payload)).run();
  return result.meta.last_row_id;
}

async function showHistory(env) {
  const { results } = await env.DB.prepare('SELECT created_at,action,status FROM history ORDER BY id DESC LIMIT 10').all();
  const actions = { create: '등록', edit: '세트 수정', remove: '세트 삭제', delete: '전체 삭제' };
  const statuses = { started: '시작(결과 미확인)', success: '성공', uncertain: '결과 미확인', rejected: '중단' };
  const lines = results.map(r => {
    const koreanTime = new Date(`${r.created_at.replace(' ', 'T')}Z`).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
    return `${koreanTime} | ${actions[r.action] ?? r.action} | ${statuses[r.status] ?? r.status}`;
  });
  await send(env, lines.length ? `최근 처리 내역 (한국 시간)\n${lines.join('\n')}` : '아직 처리 내역이 없습니다.');
}

export async function processUpdate(env, update) {
  const message = update.message ?? update.callback_query?.message;
  const from = update.message?.from ?? update.callback_query?.from;
  if (String(from?.id) !== String(env.TELEGRAM_USER_ID) || String(message?.chat?.id) !== String(env.TELEGRAM_CHAT_ID) || message?.chat?.type !== 'private') {
    console.info('Webhook ignored: owner_or_private_chat_mismatch');
    return;
  }
  if (!Number.isSafeInteger(update.update_id)) return;
  // Telegram의 동일 이벤트 재전송만 구분. 사용자가 같은 내용을 새로 보내는 것은 허용.
  const receipt = await diagnostic('database.deliveries', () => env.DB.prepare('INSERT OR IGNORE INTO deliveries(update_id) VALUES(?)').bind(update.update_id).run());
  if (!receipt.meta.changes) return;
  const callback = update.callback_query;
  if (callback) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {});
    const match = /^(run|cancel):([\da-f-]{36})$/.exec(callback.data ?? '');
    if (!match) return;
    const row = await env.DB.prepare("UPDATE pending SET status=? WHERE id=? AND status='pending' AND expires_at>? RETURNING payload").bind(match[1] === 'cancel' ? 'cancelled' : 'consumed', match[2], Date.now()).first();
    if (!row) { await send(env, '이미 처리했거나 15분이 지난 버튼입니다.'); return; }
    if (match[1] === 'cancel') { await send(env, '취소했습니다. 기록은 변경하지 않았습니다.'); return; }
    const p = JSON.parse(row.payload);
    const historyId = await history(env, p.mode, 'started', p);
    try {
      await execute(env, p);
    } catch (e) {
      await env.DB.prepare('UPDATE history SET status=? WHERE id=?').bind(e instanceof UserError ? 'rejected' : 'uncertain', historyId).run();
      await send(env, e instanceof UserError ? e.message : '처리 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다. GoodLift 기록을 확인하세요.');
      return;
    }
    await env.DB.prepare("UPDATE history SET status='success' WHERE id=?").bind(historyId).run();
    await send(env, '처리 완료했습니다. GoodLift에서 결과를 확인해주세요.');
    return;
  }
  const text = message?.text;
  if (!text) return;
  if (['/history', '처리내역', '처리 내역'].includes(text.trim())) { await showHistory(env); return; }
  if (['/start', '/help'].includes(text.trim())) {
    await send(env, '등록:\n2026-10-22\n벤치프레스 30kg 10회 3세트\n\n수정:\n2026-10-22 레그프레스 2~4세트 무게 120kg으로 수정\n\n세트 삭제:\n2026-10-22 레그프레스 3~4세트 삭제\n\n전체 삭제:\n2026-10-22 레그프레스 전체 삭제\n\n처리 내역: /history');
    return;
  }
  let p;
  try { p = await prepare(env, text); }
  catch (e) { await send(env, e instanceof UserError ? e.message : 'GoodLift 연결에 실패했습니다. 잠시 후 다시 보내주세요.'); return; }
  if (p.preview.length > 3800) { await send(env, '기록이 너무 깁니다. 나누어 보내세요.'); return; }
  const key = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE pending SET status='superseded' WHERE status='pending'"),
    env.DB.prepare('INSERT INTO pending(id,payload,expires_at) VALUES(?,?,?)').bind(key, JSON.stringify(p), Date.now() + 900000),
  ]);
  const label = p.mode === 'create' ? '등록' : p.mode === 'delete' ? '삭제' : '수정';
  await send(env, p.preview, [[{ text: label, callback_data: `run:${key}` }, { text: '취소', callback_data: `cancel:${key}` }]]);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return Response.json({ ok: true });
    if (path !== '/webhook' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
    try { await processUpdate(env, update); }
    catch (error) {
      console.error('Update failed', JSON.stringify({
        stage: error.safeStage ?? 'handler',
        status: error.safeStatus ?? null,
        reason: error.safeReason ?? 'operation_failed',
      }));
    }
    // 외부 API 성공 가능성이 있으므로 같은 이벤트를 자동 재실행하지 않는다.
    return Response.json({ ok: true });
  },
};
