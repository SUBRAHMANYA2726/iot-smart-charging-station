import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateElectricalValues, loadResistanceConfiguration } from '../estimation.mjs';

test('estimates current and power dynamically for several voltages', () => {
  const resistance = loadResistanceConfiguration({
    ESTIMATED_LOAD_RESISTANCE_AVG_OHMS: '10',
  });

  for (const voltage of [3.3, 5, 9, 12]) {
    const result = estimateElectricalValues(voltage, resistance);
    const expectedCurrent = voltage / 10;
    assert.equal(result.estimatedCurrent, expectedCurrent);
    assert.equal(result.estimatedPower, voltage * expectedCurrent);
  }
});

test('zero voltage produces zero estimated current and power', () => {
  const result = estimateElectricalValues(0, { averageOhms: 10 });
  assert.deepEqual(result, { estimatedCurrent: 0, estimatedPower: 0 });
});

test('missing, negative, and non-finite voltage values produce no estimate', () => {
  for (const voltage of [null, undefined, -1, NaN, Infinity, '5']) {
    assert.deepEqual(estimateElectricalValues(voltage, { averageOhms: 10 }), {
      estimatedCurrent: null,
      estimatedPower: null,
    });
  }
});

test('missing or invalid average resistance produces no estimate', () => {
  for (const averageOhms of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.deepEqual(estimateElectricalValues(5, { averageOhms }), {
      estimatedCurrent: null,
      estimatedPower: null,
    });
  }
});

test('resistance range is accepted only when ordered around the average', () => {
  const valid = loadResistanceConfiguration({
    ESTIMATED_LOAD_RESISTANCE_MIN_OHMS: '8',
    ESTIMATED_LOAD_RESISTANCE_AVG_OHMS: '10',
    ESTIMATED_LOAD_RESISTANCE_MAX_OHMS: '12',
  });
  assert.deepEqual(valid, { status: 'configured', averageOhms: 10 });

  const invalid = loadResistanceConfiguration({
    ESTIMATED_LOAD_RESISTANCE_MIN_OHMS: '11',
    ESTIMATED_LOAD_RESISTANCE_AVG_OHMS: '10',
    ESTIMATED_LOAD_RESISTANCE_MAX_OHMS: '12',
  });
  assert.deepEqual(invalid, { status: 'invalid', averageOhms: null });

  const invalidMaximum = loadResistanceConfiguration({
    ESTIMATED_LOAD_RESISTANCE_AVG_OHMS: '10',
    ESTIMATED_LOAD_RESISTANCE_MAX_OHMS: '9',
  });
  assert.deepEqual(invalidMaximum, { status: 'invalid', averageOhms: null });
});

test('missing calibration and invalid resistance settings are distinguishable', () => {
  const missing = loadResistanceConfiguration({});
  assert.equal(missing.status, 'missing');
  assert.deepEqual(estimateElectricalValues(5, missing), {
    estimatedCurrent: null,
    estimatedPower: null,
  });
  assert.equal(loadResistanceConfiguration({
    ESTIMATED_LOAD_RESISTANCE_AVG_OHMS: '0',
  }).status, 'invalid');
  assert.equal(loadResistanceConfiguration({
    ESTIMATED_LOAD_RESISTANCE_AVG_OHMS: '10',
    ESTIMATED_LOAD_RESISTANCE_MIN_OHMS: 'not-a-resistance',
  }).status, 'invalid');
});
