export function writeErrorStatus(error, fallbackStatus = 503) {
  return error?.name === "VersionError" ? 409 : fallbackStatus;
}

export function writeErrorMessage(error) {
  return error?.name === "VersionError" ? "write_conflict" : error.message;
}
