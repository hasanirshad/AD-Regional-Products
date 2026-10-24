// Saving a group = three small steps, in this order, so a failure in the
// middle never leaves the app and Shopify out of step without a way to retry:
//   1. save the group (profile id empty or the existing one)
//   2. create or update the shipping profile in Shopify
//   3. save the group again with the profile id
// If step 2 fails the group shows "No profile yet" and saving again retries.

import { newGroupId, profileNameFor, GROUPS_KEY, type Draft } from "./groups";
import { planProfile, toProfileInput, toProfileUpdateInput } from "./plan";
import { createProfile, updateProfile } from "./shopify-data";
import { writeJson } from "./store";
import type { GeneralProfile, Group, GroupsFile, ProfileSummary } from "./types";

async function saveFile(groups: Group[]): Promise<void> {
  const file: GroupsFile = { version: 1, groups };
  await writeJson(GROUPS_KEY, file);
}

export async function saveGroup(args: {
  draft: Draft;
  groups: Group[];
  general: GeneralProfile;
  profiles: ProfileSummary[];
}): Promise<{ groups: Group[]; profileId: string }> {
  const { draft, general, profiles } = args;
  const name = draft.name.trim();
  const existing = draft.id ? args.groups.find((g) => g.id === draft.id) : undefined;
  const profile = existing?.profileId ? profiles.find((p) => p.id === existing.profileId) : undefined;

  if (profile?.isDefault) throw new Error("The General profile can never be changed by a group.");

  const base: Group = {
    id: existing?.id ?? newGroupId(),
    name,
    countries: [...new Set(draft.countries.map((c) => c.toUpperCase()))],
    profileId: profile ? profile.id : null,
  };
  const others = args.groups.filter((g) => g.id !== base.id);

  // Step 1
  await saveFile([...others, base]);

  // Step 2
  const plan = planProfile(general, base.countries);
  if (plan.locationGroups.length === 0) {
    throw new Error("General has no shipping rates that can be copied for these countries, so there is nothing to create.");
  }
  const profileName = profileNameFor(name);
  let profileId: string;
  if (profile) {
    await updateProfile(profile.id, toProfileUpdateInput(profileName, plan, profile));
    profileId = profile.id;
  } else {
    profileId = await createProfile(toProfileInput(profileName, plan));
  }

  // Step 3
  const finished: Group = { ...base, profileId };
  const groups = [...others, finished];
  await saveFile(groups);
  return { groups, profileId };
}
