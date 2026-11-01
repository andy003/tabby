import type { FileTransfer } from './api/platform'

export interface TransferJob {
    transfer: FileTransfer
    run: () => Promise<void>
}

export interface TransferSummary {
    queued: number
    running: number
    completed: number
    failed: number
    cancelled: number
}

/** Complete every queued item even when an individual transfer fails. */
export async function runTransferJobs (jobs: TransferJob[], cancelled: () => boolean = () => false): Promise<void> {
    for (const job of jobs) {
        if (cancelled()) { job.transfer.cancel() }
        if (!job.transfer.isActive()) { continue }
        job.transfer.setStarted()
        try {
            await job.run()
            job.transfer.setCompleted(true)
        } catch (error) {
            job.transfer.setFailed(error instanceof Error ? error.message : String(error))
            job.transfer.close()
        }
    }
}

export function getTransferSummary (transfers: FileTransfer[]): TransferSummary {
    const summary: TransferSummary = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }
    const visit = (transfer: FileTransfer) => {
        const children = transfer.getChildren()
        if (children.length) {
            children.forEach(visit)
        } else {
            summary[transfer.getState()]++
        }
    }
    transfers.forEach(visit)
    return summary
}

export function failTransferTree (transfer: FileTransfer, error: string): void {
    if (transfer.isActive()) {
        transfer.setFailed(error)
        transfer.close()
    }
    transfer.getChildren().forEach(child => failTransferTree(child, error))
}
