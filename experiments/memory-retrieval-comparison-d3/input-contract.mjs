// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { json, fields, text, digest } from './contracts.mjs';

const SCHEMA = 'viberoom-retrieval-offline-payload-plan-v1';
const HISTORICAL = Object.freeze(['baseline-off-current', 'original-profile']);
const BASE_FIELDS = ['schema', 'corpusSha256', 'runId', 'physicalAddresses', 'rows'];
const pair = (variant, room) => JSON.stringify([variant, room]);
const source = row => JSON.stringify([row.variant, row.logicalRoom, row.sourceId]);

export function inputContract(input) {
  const payloads = json(input);
  assert.ok(payloads && typeof payloads === 'object' && !Array.isArray(payloads), 'D2 payloads must be an object');
  const current = Object.hasOwn(payloads, 'variants');
  fields(payloads, current ? [...BASE_FIELDS, 'variants', 'dropped'] : BASE_FIELDS);
  assert.equal(payloads.schema, SCHEMA);
  digest(payloads.corpusSha256); text(payloads.runId);

  const catalogue = new Map();
  if (current) {
    assert.ok(Array.isArray(payloads.variants) && payloads.variants.length > 0, 'D2 variants must be a nonempty catalogue');
    for (const variant of payloads.variants) {
      fields(variant, ['name', 'memoryInput', 'title']); text(variant.name); text(variant.title);
      assert.ok(['excerpts', 'whole'].includes(variant.memoryInput), 'Unknown D2 memoryInput');
      assert.ok(!catalogue.has(variant.name), 'Duplicate D2 variant');
      catalogue.set(variant.name, variant.memoryInput);
    }
  } else for (const name of HISTORICAL) catalogue.set(name, null);

  assert.ok(Array.isArray(payloads.physicalAddresses) && payloads.physicalAddresses.length > 0, 'D2 physical addresses must be nonempty');
  assert.ok(Array.isArray(payloads.rows), 'D2 rows must be an array');
  const addresses = new Map(), rooms = new Set();
  for (const address of payloads.physicalAddresses) {
    assert.ok(address && typeof address === 'object' && !Array.isArray(address), 'D2 address must be an object');
    text(address.variant); text(address.logicalRoom);
    text(address.room?.uuid);
    assert.ok(catalogue.has(address.variant), 'Address variant is outside the D2 catalogue');
    const key = pair(address.variant, address.logicalRoom);
    assert.ok(!addresses.has(key), 'Duplicate D2 room/variant address');
    addresses.set(key, { count: 0, roomUuid: address.room.uuid }); rooms.add(address.logicalRoom);
  }
  for (const room of rooms) for (const name of catalogue.keys())
    assert.ok(addresses.has(pair(name, room)), 'D2 room is missing a variant address');

  const kept = new Set();
  for (const row of payloads.rows) {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'D2 row must be an object');
    text(row.variant); text(row.logicalRoom); text(row.sourceId);
    const key = pair(row.variant, row.logicalRoom);
    assert.ok(addresses.has(key), 'Orphan D2 row');
    assert.equal(row.room?.uuid, addresses.get(key).roomUuid, 'D2 row room identity differs from its address');
    if (current) assert.equal(row.input, catalogue.get(row.variant), 'D2 row input differs from its variant');
    const identity = source(row);
    assert.ok(!kept.has(identity), 'Duplicate D2 kept source');
    kept.add(identity); addresses.get(key).count++;
  }
  if (!current) for (const address of addresses.values())
    assert.ok(address.count > 0, 'Historical D2 address has no rows');

  if (current) {
    assert.ok(Array.isArray(payloads.dropped), 'D2 dropped must be an array');
    const dropped = new Set();
    for (const row of payloads.dropped) {
      fields(row, ['variant', 'sourceId', 'logicalRoom']);
      text(row.variant); text(row.sourceId); text(row.logicalRoom);
      assert.ok(addresses.has(pair(row.variant, row.logicalRoom)), 'Orphan D2 dropped source');
      const identity = source(row);
      assert.ok(!dropped.has(identity), 'Duplicate D2 dropped source');
      assert.ok(!kept.has(identity), 'D2 source is both kept and dropped');
      dropped.add(identity);
    }
  }

  const variants = Object.freeze([...catalogue.keys()]);
  return Object.freeze({
    form: current ? 'current-d2-variants' : 'historical-d2-v1', variants,
    rotate(n) {
      assert.ok(Number.isSafeInteger(n) && n >= 0, 'D2 rotation needs a nonnegative question index');
      const at = n % variants.length;
      return Object.freeze([...variants.slice(at), ...variants.slice(0, at)]);
    },
  });
}
