// The Grievance Officer's real details, read from the environment.
//
// ONE reader, because three surfaces need the same answer: the public /grievance page, the in-app
// page (via /api/public-config), and the admin warning that says the page is incomplete. Read in
// three places, they would drift — and a compliance page that disagrees with itself is worse than
// one that is merely unfinished.
//
// 🔒 NOTHING HERE IS SECRET. A Grievance Officer's name and contact are PUBLISHED BY LAW; that is
// the entire point of the role. They are env values only because they are a deployment fact the
// admin owns, not because they need protecting.

import { grievanceOfficerFrom, type GrievanceOfficer } from '../../content/legal/grievance';

export function grievanceOfficer(env: NodeJS.ProcessEnv = process.env): GrievanceOfficer {
  return grievanceOfficerFrom({
    name: env.GRIEVANCE_OFFICER_NAME,
    email: env.GRIEVANCE_OFFICER_EMAIL,
    phone: env.GRIEVANCE_OFFICER_PHONE,
    address: env.GRIEVANCE_OFFICER_ADDRESS,
  });
}
