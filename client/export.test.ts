import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFileName, planToCsv, planToJson } from './export';
import type { PlanState } from './store';

const t = (id: string, name: string, seats = 8) =>
  ({ _id: id, _creationTime: 0, planId: 'p', name, shape: 'round', seats, x: 0, y: 0, rotation: 0 }) as PlanState['tables'][number];
const g = (id: string, name: string, tableId?: string, seat?: number) =>
  ({ _id: id, _creationTime: 0, planId: 'p', name, look: 7, tableId, seat }) as PlanState['guests'][number];

const state: PlanState = {
  plan: { _id: 'p', _creationTime: 0, slug: 'ours', name: 'Our Wedding' } as PlanState['plan'],
  tables: [t('t10', 'Table 10'), t('t2', 'Table 2')],
  guests: [g('g1', 'Zed'), g('g2', 'Amy "Ames" Lee', 't10', 0), g('g3', 'Bob, Jr', 't2', 3), g('g4', 'Cal', 't2', 1)],
};

test('csv lists seated guests by table then seat, unseated last, with quoting', () => {
  const lines = planToCsv(state).split('\r\n');
  assert.deepEqual(lines, [
    'Guest,Table,Seat',
    'Cal,Table 2,2',
    '"Bob, Jr",Table 2,4',
    '"Amy ""Ames"" Lee",Table 10,1',
    'Zed,,',
    '',
  ]);
});

test('json keeps ids so guests can be matched to tables', () => {
  const out = planToJson(state, 'ours', new Date('2026-11-08T04:32:00Z'));
  assert.equal(out.format, 'wedding-seat-planner/plan@1');
  assert.equal(out.exportedAt, '2026-11-08T04:32:00.000Z');
  assert.deepEqual(out.plan, { name: 'Our Wedding' });
  assert.deepEqual(out.tables.map((x) => x.id), ['t2', 't10']);
  assert.equal(out.guests.find((x) => x.id === 'g3')?.tableId, 't2');
  assert.equal(out.guests[0].look, 7);
});

test('file name comes from the plan name and the time', () => {
  const now = new Date(2026, 10, 8, 14, 5);
  assert.equal(exportFileName(state, 'ours', 'json', now), 'our-wedding-2026-11-08-1405.json');
  assert.equal(exportFileName({ ...state, plan: null }, 'ours', 'csv', now), 'ours-2026-11-08-1405.csv');
});
