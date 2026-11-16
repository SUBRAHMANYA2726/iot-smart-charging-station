function parseResistance(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { configured: false, value: null };
  }
  const parsed = Number(value);
  return { configured: true, value: Number.isFinite(parsed) && parsed > 0 ? parsed : null };
}

export function loadResistanceConfiguration(environment) {
  const minimum = parseResistance(environment.ESTIMATED_LOAD_RESISTANCE_MIN_OHMS);
  const average = parseResistance(environment.ESTIMATED_LOAD_RESISTANCE_AVG_OHMS);
  const maximum = parseResistance(environment.ESTIMATED_LOAD_RESISTANCE_MAX_OHMS);
  const anyConfigured = minimum.configured || average.configured || maximum.configured;
  const boundsValid = average.value !== null
    && (!minimum.configured || (minimum.value !== null && minimum.value <= average.value))
    && (!maximum.configured || (maximum.value !== null && average.value <= maximum.value));
  const configured = average.value !== null && boundsValid;

  return {
    status: configured ? 'configured' : anyConfigured ? 'invalid' : 'missing',
    averageOhms: configured ? average.value : null,
  };
}

export function estimateElectricalValues(voltage, resistanceConfiguration) {
  const resistance = resistanceConfiguration?.averageOhms;
  if (typeof voltage !== 'number' || !Number.isFinite(voltage) || voltage < 0
    || typeof resistance !== 'number' || !Number.isFinite(resistance) || resistance <= 0) {
    return { estimatedCurrent: null, estimatedPower: null };
  }

  const estimatedCurrent = voltage / resistance;
  const estimatedPower = voltage * estimatedCurrent;
  if (!Number.isFinite(estimatedCurrent) || !Number.isFinite(estimatedPower)) {
    return { estimatedCurrent: null, estimatedPower: null };
  }

  return { estimatedCurrent, estimatedPower };
}
