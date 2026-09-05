'use strict';

function applyDescriptionOverride(catalog, skillName, description) {
  let found = false;
  const updated = (catalog || []).map((skill) => {
    if (skill.name !== skillName) return { ...skill };
    found = true;
    return { ...skill, description };
  });
  if (!found) throw new Error(`catalog skill not found: ${skillName}`);
  return updated;
}

function scoreRoutingBoundary(results) {
  const rows = (results || []).filter((row) => row && row.arm_id && row.expected);
  const armIds = [...new Set(rows.map((row) => row.arm_id))];
  const byArm = {};
  for (const armId of armIds) {
    const armRows = rows.filter((row) => row.arm_id === armId);
    const scientific = armRows.filter((row) => row.expected === 'thinking-scientific-method');
    const fiveWhys = armRows.filter((row) => row.expected === 'thinking-five-whys-plus');
    const correct = (subset) => subset.filter((row) => row.chosen === row.expected).length;
    byArm[armId] = {
      n: armRows.length,
      strict_accuracy: armRows.length ? correct(armRows) / armRows.length : null,
      scientific_method_accuracy: scientific.length ? correct(scientific) / scientific.length : null,
      five_whys_accuracy: fiveWhys.length ? correct(fiveWhys) / fiveWhys.length : null,
    };
  }
  const current = byArm.current;
  const boundary = byArm.boundary;
  const boundaryPass = Boolean(
    current
    && boundary
    && boundary.strict_accuracy > current.strict_accuracy
    && boundary.five_whys_accuracy >= current.five_whys_accuracy,
  );
  return {
    by_arm: byArm,
    boundary_pass: boundaryPass,
  };
}

module.exports = {
  applyDescriptionOverride,
  scoreRoutingBoundary,
};
