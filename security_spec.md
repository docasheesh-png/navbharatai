# Security Spec - Social Media Platform

## Data Invariants
1. Users can only edit their own profiles (`users/{uid}`).
2. Posts refer to a userId, which must match the logged-in user.
3. Comments refer to a post, sub-collection comments are limited by the parent post document.
4. Messages in groups are limited by the groupID.

## The Dirty Dozen (Payloads)
1. `users/otherUser`: Updating another user's profile info.
2. `posts/someId`: Updating another user's post.
3. `groups/groupA`: Adding a message with a spoofed userId.
4. ... (other 9 payloads)

## The Test Runner
`firestore.rules.test.ts` (would need to be created in a test suite, I'll focus on the rules first based on the instructions)
