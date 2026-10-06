import { reportRemoteFeedPreparation } from '../backend/prepare-remote-feed.mjs';

// Run explicitly in the existing server environment; never copy secrets to chat.
if (!await reportRemoteFeedPreparation()) process.exitCode = 1;
