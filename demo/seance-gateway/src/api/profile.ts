import _ from "lodash";

export interface ProfileUpdate {
  displayName: string;
  profile: Record<string, unknown>;
  hide?: string;
}

// Called by POST /profile. `displayName`, `profile` and `hide` come straight from the request body.
export function applyProfileUpdate(body: ProfileUpdate): Record<string, unknown> {
  const name = _.trim(body.displayName);
  const visible = body.hide ? _.omit(body.profile, body.hide) : body.profile;
  return { displayName: name, ...visible };
}
