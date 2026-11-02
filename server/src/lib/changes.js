/**
 * Lists the API fields whose value actually differs from the current row.
 * Only field names go into the audit log; values may be personal data and the log is immutable.
 */
function changedFields(row, changes, fieldToColumn) {
  return Object.entries(fieldToColumn)
    .filter(([field, column]) => changes[field] !== undefined && changes[field] !== row[column])
    .map(([field]) => field);
}

module.exports = { changedFields };
