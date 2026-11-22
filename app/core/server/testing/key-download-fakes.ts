import type { KeyDownloadAttachRepository, KeyDownloadFileRepository } from '../key-download-ports.js';

const unused = (name: string) => () => Promise.reject(new Error(`${name} is not used here`));

export const unusedKeyDownloadRepositories = (): { keyDownloadFiles: KeyDownloadFileRepository; keyDownloadAttach: KeyDownloadAttachRepository } => ({
  keyDownloadFiles: {
    reserve: unused('reserve'),
    claimCompletion: unused('claimCompletion'),
    finishCompletion: unused('finishCompletion'),
    releaseRecord: unused('releaseRecord'),
    interruptAttempt: unused('interruptAttempt'),
    listRecordEvents: unused('listRecordEvents'),
    findStaged: unused('findStaged'),
    listStaged: unused('listStaged'),
    discard: unused('discard'),
    finishDeletion: unused('finishDeletion'),
    sweepStaged: unused('sweepStaged'),
    listTenantIdsToSweep: unused('listTenantIdsToSweep'),
    listToSweep: unused('listToSweep'),
    markAttempted: unused('markAttempted'),
    purgeSettled: unused('purgeSettled'),
  },
  keyDownloadAttach: {
    attach: unused('attach'),
    remove: unused('remove'),
  },
});
