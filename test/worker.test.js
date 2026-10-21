import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { parse, changeSets } from '../src/domain.js';
import { queryDate, formatDailyRecords, splitReply } from '../src/query.js';

test('조회 명령은 등록과 구분하고 오늘·어제는 한국 날짜로 계산', () => {
  const now = new Date('2026-12-31T15:01:00Z');
  assert.equal(queryDate('2026-10-22'), '2026-10-22');
  assert.equal(queryDate('2026년 10월 22일 조회'), '2026-10-22');
  assert.equal(queryDate(' 오늘 조회 ', now), '2027-01-01');
  assert.equal(queryDate('어제조회', now), '2026-12-31');
  assert.equal(queryDate('어제 조회', new Date('2024-02-29T15:01:00Z')), '2024-02-29');
  assert.equal(queryDate('2026-10-22\n벤치프레스30kg10회3세트'), null);
  assert.equal(queryDate('2026-10-22 레그프레스 전체 삭제'), null);
  assert.throws(() => queryDate('2026-02-30 조회'));
  assert.throws(() => queryDate('다음주 조회'));
});

test('조회 결과는 세트·시간·메모를 표시하고 긴 기록을 손실 없이 분할', () => {
  assert.match(formatDailyRecords('2026-10-22', []), /기록이 없습니다/);
  const reply = formatDailyRecords('2026-10-22', [
    { workout_type_name: '벤치프레스', sets: JSON.stringify([{ set_number: 1, weight: 30, reps: 10 }]) },
    { workout_type_name: '러닝', sets: null, duration_minutes: 20, duration_seconds: 30, notes: '가볍게' },
  ]);
  assert.match(reply, /30kg × 10회/);
  assert.match(reply, /20분 30초/);
  assert.match(reply, /가볍게/);
  const long = reply.repeat(200) + '💪'.repeat(4000);
  const chunks = splitReply(long);
  assert.equal(chunks.join(''), long);
  assert.ok(chunks.every(s => s.length <= 3500 && !/[\uD800-\uDBFF]$/.test(s)));
});

test('운동 문장·공백·무게 상속·단위·잘못된 범위 검증', () => {
  const p = parse('2026년 10월 22일\n벤치프레스30kg10회3세트\n레그 프레스 100 kg 10 회 1 세트, 이후 12개씩 3세트');
  assert.equal(p.day, '2026-10-22');
  assert.equal(p.workouts[0].sets.length, 3);
  assert.deepEqual(p.workouts[1].sets.map(s => [s.weight, s.reps]), [[100, 10], [100, 12], [100, 12], [100, 12]]);
  assert.equal(parse('2026-10-22 레그프레스 2세트 횟수 15회로 수정').value, 15);
  assert.throws(() => parse('2026-02-30\n벤치프레스 30kg 10회 1세트'));
  assert.throws(() => parse('2026-10-22 레그프레스 4~2세트 삭제'));
  assert.throws(() => parse('2026-10-22 레그프레스 2세트 횟수 1.5회 수정'));
});

test('부분 삭제 시 세트 ID와 완료 상태 보존, 마지막 세트 삭제 거절', () => {
  const record = { sets: [{ id: 'a', set_number: 1, weight: 30, reps: 10, is_completed: true }, { id: 'b', set_number: 2, weight: 40, reps: 12, is_completed: false }] };
  const result = changeSets(record, { mode: 'remove', start: 1, end: 1 });
  assert.deepEqual(result, [{ id: 'b', set_number: 1, weight: 40, reps: 12, is_completed: false }]);
  assert.throws(() => changeSets(record, { mode: 'remove', start: 1, end: 2 }));
  assert.equal(record.sets.length, 2);
});

test('진단 로그는 DB 실패와 Telegram HTTP 오류를 구분하고 비밀 값을 숨김', async () => {
  const env = { WEBHOOK_SECRET: 'secret', TELEGRAM_USER_ID: '1', TELEGRAM_CHAT_ID: '1', TELEGRAM_BOT_TOKEN: 'DO_NOT_LOG_THIS_TOKEN' };
  const logs = [];
  const originalFetch = globalThis.fetch, originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  const request = id => new Request('https://test.example/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
    body: JSON.stringify({ update_id: id, message: { from: { id: 1 }, chat: { id: 1, type: 'private' }, text: '/help' } }),
  });
  try {
    env.DB = { prepare() { throw new Error('no such table: deliveries DO_NOT_LOG_THIS_TOKEN'); } };
    assert.equal((await worker.fetch(request(1), env)).status, 200);
    assert.match(logs.at(-1), /database.deliveries/);
    assert.match(logs.at(-1), /missing_table/);
    env.DB = database();
    globalThis.fetch = async () => new Response('DO_NOT_LOG_THIS_TOKEN', { status: 401 });
    assert.equal((await worker.fetch(request(2), env)).status, 200);
    assert.match(logs.at(-1), /telegram.sendMessage/);
    assert.match(logs.at(-1), /401/);
    assert.ok(logs.every(s => !s.includes('DO_NOT_LOG_THIS_TOKEN')));
  } finally {
    env.DB.sqlite?.close();
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const wrap = (sql, values = []) => ({
    bind: (...args) => wrap(sql, args),
    run: async () => {
      const result = sqlite.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  return { prepare: sql => wrap(sql), batch: statements => Promise.all(statements.map(s => s.run())), sqlite };
}

test('웹훅부터 확인 버튼·등록·수정·부분 삭제·전체 삭제·이력까지', async () => {
  const DB = database();
  const env = { DB, WEBHOOK_SECRET: 'test-secret', TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_USER_ID: '1', TELEGRAM_CHAT_ID: '1', GOODLIFT_USERNAME: 'test', GOODLIFT_PASSWORD: 'test' };
  let records = [], writes = 0, unknown = false, updateId = 0;
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const body = options.body ? JSON.parse(options.body) : {};
    if (u.hostname === 'api.telegram.org') {
      if (u.pathname.endsWith('/sendMessage')) sent.push(body);
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }
    if (u.pathname === '/api/login') return Response.json({ userType: 'app_user', id: 'owner' });
    if (u.pathname === '/api/workout-types') return Response.json([{ id: 'leg', name: '레그 프레스', type: '세트' }]);
    if (u.pathname === '/api/workout-records' && !options.body) return Response.json(records);
    if (u.pathname.endsWith('/batch')) {
      writes++;
      records.push(...body.workout_records.map((r, i) => ({ ...r, id: `record-${writes}-${i}`, workout_type_name: '레그 프레스', sets: r.sets.map((s, n) => ({ ...s, id: `set-${writes}-${n}`, is_completed: n === 0 })) })));
      if (unknown) throw new Error('simulated timeout after mutation');
      return Response.json({ ok: true });
    }
    if (options.method === 'PATCH') {
      writes++;
      const index = records.findIndex(r => r.id === u.pathname.split('/').at(-1));
      records[index] = { ...records[index], ...body };
      return Response.json({ ok: true });
    }
    if (options.method === 'DELETE') {
      writes++;
      records = records.filter(r => r.id !== u.pathname.split('/').at(-1));
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected request');
  };
  const deliver = async (update, secret = 'test-secret') => worker.fetch(new Request('https://test.example/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update),
  }), env);
  const message = (text, user = 1) => deliver({ update_id: ++updateId, message: { from: { id: user }, chat: { id: 1, type: 'private' }, text } });
  const button = (data = sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data) => deliver({ update_id: ++updateId, callback_query: { id: 'cb', from: { id: 1 }, message: { chat: { id: 1, type: 'private' } }, data } });
  try {
    assert.equal((await deliver({ update_id: 99 }, 'bad-secret')).status, 403);
    await message('2026-10-22\n레그프레스 100kg 10회 1세트, 12회 3세트', 2);
    assert.equal(sent.length, 0);
    await message('2026-10-22 조회');
    assert.match(sent.at(-1).text, /기록이 없습니다/);
    assert.equal(writes, 0);
    await message('2026-10-22\n레그프레스 100kg 10회 1세트, 12회 3세트');
    assert.equal(writes, 0);
    const firstButton = sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data;
    await message('2026-10-22');
    assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM pending WHERE status='pending'").get().n, 1);
    await button(firstButton);
    assert.equal(records[0].sets.length, 4);
    const historyBeforeQuery = DB.sqlite.prepare('SELECT count(*) n FROM history').get().n;
    await message('2026년 10월 22일 조회');
    assert.match(sent.at(-1).text, /레그 프레스/);
    assert.match(sent.at(-1).text, /4세트: 100kg × 12회/);
    assert.equal(sent.at(-1).reply_markup, undefined);
    assert.equal(writes, 1);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM history').get().n, historyBeforeQuery);
    await message('2026-10-23 조회');
    assert.match(sent.at(-1).text, /기록이 없습니다/);
    const writesAfterCreate = writes;
    await deliver({ update_id: ++updateId, callback_query: { id: 'cb', from: { id: 1 }, message: { chat: { id: 1, type: 'private' } }, data: firstButton } });
    assert.equal(writes, writesAfterCreate);
    await message('2026-10-22 레그프레스 2~4세트 무게 120kg으로 수정');
    await button();
    assert.deepEqual(records[0].sets.map(s => s.weight), [100, 120, 120, 120]);
    assert.equal(records[0].sets[0].is_completed, true);
    await message('2026-10-22 레그프레스 3~4세트 삭제');
    await button();
    assert.equal(records[0].sets.length, 2);
    await message('2026-10-22 레그프레스 전체 삭제');
    await button();
    assert.equal(records.length, 0);
    // 같은 운동을 새 메시지로 반복 등록하는 것은 허용한다.
    for (let i = 0; i < 2; i++) {
      await message('2026-10-22\n레그프레스 100kg 10회 1세트');
      await button();
    }
    assert.equal(records.length, 2);
    await message('2026-10-22 레그프레스 전체 삭제');
    assert.match(sent.at(-1).text, /2개/);
    unknown = true;
    await message('2026-10-22\n레그프레스 100kg 10회 1세트');
    const uncertainButton = sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data;
    await button();
    assert.match(sent.at(-1).text, /자동 재시도하지 않습니다/);
    const afterTimeout = writes;
    await deliver({ update_id: ++updateId, callback_query: { id: 'cb', from: { id: 1 }, message: { chat: { id: 1, type: 'private' } }, data: uncertainButton } });
    assert.equal(writes, afterTimeout);
    await message('/history');
    assert.match(sent.at(-1).text, /결과 미확인/);
    assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM history WHERE status='success'").get().n, 6);
    assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM history WHERE status='uncertain'").get().n, 1);
  } finally { globalThis.fetch = originalFetch; DB.sqlite.close(); }
});
