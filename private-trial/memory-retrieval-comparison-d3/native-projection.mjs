// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { types } from 'node:util';
import { json } from './contracts.mjs';

export function captureDeclaredObject(input, { keys, optionalUndefined = [], convert = (_key, value) => json(value), passthroughEvidence = false, setAsideUnknown = false, reserved = [] }) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input) && !types.isProxy(input));
  assert.ok(Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null);
  assert.ok(optionalUndefined.every(key => keys.includes(key)));
  assert.equal(typeof passthroughEvidence, 'boolean'); assert.equal(typeof setAsideUnknown, 'boolean'); assert.ok(!(passthroughEvidence && setAsideUnknown));
  const row = {}, undefinedOptionalFields = [], passthroughFields = [], unknownNativeFields = {};
  for (const key of Reflect.ownKeys(input)) {
    assert.equal(typeof key, 'string'); assert.ok(!reserved.includes(key), 'Reserved local-layout field');
    assert.ok(keys.includes(key) || passthroughEvidence || setAsideUnknown, 'Unknown native field');
    const d = Object.getOwnPropertyDescriptor(input, key);
    assert.ok(d && d.enumerable && Object.hasOwn(d, 'value'), 'Accessor/hidden native field');
    if (setAsideUnknown && !keys.includes(key)) { if (d.value !== undefined) unknownNativeFields[key] = json(d.value); }
    else if (d.value === undefined) {
      assert.ok(optionalUndefined.includes(key), 'Undeclared/required undefined native field');
      undefinedOptionalFields.push(key);
    } else {
      const declared = keys.includes(key);
      if (!declared) passthroughFields.push(key);
      Object.defineProperty(row, key, { value: json(declared ? convert(key, d.value) : d.value), enumerable: true });
    }
  }
  const captured = { row: json(row), undefinedOptionalFields: undefinedOptionalFields.sort() };
  if (Object.keys(unknownNativeFields).length) captured.unknownNativeFields = unknownNativeFields;
  return passthroughEvidence ? { ...captured, passthroughFields: passthroughFields.sort() } : captured;
}

export function verifyUnknownNativeFields(layout, declared) {
  if (!Object.hasOwn(layout, 'unknownNativeFields')) return;
  const unknown = layout.unknownNativeFields;
  assert.ok(unknown && typeof unknown === 'object' && !Array.isArray(unknown) && Object.keys(unknown).length, 'Malformed unknown native fields');
  assert.ok(Object.keys(unknown).every(key => !declared.includes(key)), 'Declared field set aside as unknown');
  json(unknown);
}

export function captureDeclaredArray(input, convert = value => json(value)) {
  assert.ok(Array.isArray(input) && !types.isProxy(input));
  assert.deepEqual(Reflect.ownKeys(input), [...Array.from({ length: input.length }, (_, i) => String(i)), 'length']);
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    assert.ok(d && d.enumerable && Object.hasOwn(d, 'value'), 'Accessor/hidden native array element');
    out.push(convert(d.value, i));
  }
  return out;
}
