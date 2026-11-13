# Firestore Security Specification - Aliat Intel·ligent

## Data Invariants
1. A `UserProfile` at `/users/{userId}` can only be read, created, updated, or deleted by the authenticated owner whose Firebase Auth `uid == userId` and `request.auth.token.email_verified == true`.
2. Listing `/users` is strictly forbidden (`allow list: if false`) to prevent PII (`email`) enumeration.
3. All writes enforce strict key allowlists (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly()` on update), immutable `uid`/`email`/`createdAt`, and server-enforced timestamps (`request.time`).
4. `UserSettings` documents at `/users/{userId}/settings/{settingId}` require the parent `/users/{userId}` document to exist, `ownerId == request.auth.uid`, and verified owner identity.

## Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated read on `/users/{uid}` -> `PERMISSION_DENIED`
2. Cross-user read `/users/{otherUid}` -> `PERMISSION_DENIED`
3. Unverified email (`email_verified: false`) create on `/users/{uid}` -> `PERMISSION_DENIED`
4. Shadow field injection (`{ isAdmin: true }`) on create/update -> `PERMISSION_DENIED`
5. Identity spoofing (`uid: otherUid` inside body) -> `PERMISSION_DENIED`
6. Forged client `createdAt` or `updatedAt` timestamp != `request.time` -> `PERMISSION_DENIED`
7. Oversized `displayName` (> 120 chars) or `photoURL` (> 1024 chars) -> `PERMISSION_DENIED`
8. Oversized / invalid document ID (`!^[a-zA-Z0-9_\-]+$`) -> `PERMISSION_DENIED`
9. List query on `/users` collection -> `PERMISSION_DENIED`
10. Orphaned `settings` write when `/users/{uid}` does not exist -> `PERMISSION_DENIED`
11. Mutating immutable `uid` or `createdAt` on `/users/{uid}` update -> `PERMISSION_DENIED`
12. Storing disallowed keys (e.g. `aiKey`) inside `/users/{uid}/settings/{settingId}` -> `PERMISSION_DENIED`
