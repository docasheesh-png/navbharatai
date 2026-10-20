# Default Supabase organization for NavBharatAI apps

Requested organization: `hkfoligpzrmcasgtzeoe` (docasheesh-png's Org).
Existing project: `mtbdjypjlnjghapdtedj`, restored and verified ACTIVE_HEALTHY on
2026-10-20, with no public tables or Storage buckets. It is NOT a shared customer database.
New projects use `ap-south-1`; the existing Sydney project is not moved.

## Result and scope

`NAVBHARAT_SUPABASE_DEFAULT=on` makes the main Publish database offer a dedicated
project in the configured platform organization, with that product's price and terms.
Every app gets its own database password and project-scoped public credentials, saved
in the encrypted workspace vault. The platform management token never enters app env.
Supabase provides database, Auth and Storage; Cloud Run/Firebase still serve apps.
Storage buckets and app migrations must use the ownership/RLS policies from the hosting
audit. This setting does not invent a shared bucket, apply arbitrary SQL, or migrate old data.
Existing shared databases retain their controls. BYO Supabase stays available.
A stale shared-purchase request receives 409 and must refresh/review the new product.
Customer wallet consent is still required; choosing the platform default buys nothing for users.

## Activation prerequisites (not yet performed)

1. Approve and upgrade the selected organization to Pro in Supabase. The ChatGPT
   connector is not an application runtime credential. No subscription was upgraded here.
2. Put an organization-authorized Supabase management token into the production GCP
   Secret Manager using the secure console/secret workflow. Do not paste it in chat or git.
   Give only the NavBharatAI service identity access; pin its numeric version.
3. Confirm the actual GCP project, existing Cloud Run service and region. They are
   deliberately required inputs, not guesses. Merge/deploy the reviewed code first.
4. Preview this command (all names below are placeholders):

```sh
node scripts/configurePlatformSupabase.mjs \
  --gcp-project=PROJECT --service=SERVICE --run-region=REGION \
  --token-secret=SECRET_NAME --secret-version=1 --max-projects=2
```

The default is DRY RUN. After explicit bill approval and verified Pro organization,
append `--apply --confirm-pro-org=hkfoligpzrmcasgtzeoe --approve-baseline-usd=35`.
This updates only existing Cloud Run env/secret bindings. It does not upgrade a plan,
create a project or grant IAM. Missing runtime credentials/approval fails closed.
Review the resulting revision, then use a consenting pilot app to verify creation,
Auth, own-record CRUD, private Storage isolation, wallet receipt and removal end to end.
Do not announce live activation until that check passes.

## Cost and capacity

Official sources: https://supabase.com/pricing and
https://supabase.com/docs/guides/platform/billing-faq (checked 2026-10-20).
Pro base is $25/month, with $10 compute credit; Micro projects are approximately
$10/project/month. For N total Micro projects, estimate $15 + $10*N/month.
Existing projects count too: existing project + 1 new app ≈ $35/month; existing +
10 new apps ≈ $125/month. Usage, tax, add-ons and larger compute are extra.
`NAVBHARAT_SUPABASE_MAX_PROJECTS` includes ALL org projects, conservatively including
paused projects. It caps automated creation, not the invoice. Manual provider changes
and external creators bypass this application cap. Pricing must be rechecked before approval.
Never treat Pro's spend cap as a complete compute/invoice cap.

## Interrupted operations and reconciliation

Creation is serialized in the server-only Firestore document
`platform_settings/supabase_creation_ORGANIZATION_ID`. A lost acquisition acknowledgement
starts no provider request. The hold has NO automatic expiry: a process death, ambiguous
provider response, payment result or incomplete cleanup blocks another purchase.
It stores an opaque app hash and provider ref when known, never secrets.
A known successful delivery or confirmed cleanup releases only the owning nonce.
Capacity is read from the Management API while the hold is owned; errors/malformed
responses start no project. This also guards the explicit dedicated purchase endpoint
while managed default is on. Existing manual/legacy provisioning paths are not covered.

For a retained hold, compare provider projects/creation time, workspace vault and wallet
ledger. Recover delivery or explicitly resolve cleanup/refund. Only after confirming no
operation is still running and all outcomes are reconciled may an operator remove the
hold document. A blind retry/TTL deletion can cause duplicate paid resources.

## Rollback and data protection

To stop new managed purchases immediately, set
`NAVBHARAT_SUPABASE_PRODUCTION_APPROVED=off` and keep the token bound so existing
projects can still be deleted through Publish. Configuration reads retain that token
for lifecycle operations; purchase admission checks activation independently.
Disable the default only after reviewing pending holds and existing database controls.
Never delete a live app project as a deployment rollback. Back up customer databases
and Storage objects separately; Supabase database backups do not contain object bytes.
A production launch still needs a documented restore drill and a nonzero-cost pilot approval.
