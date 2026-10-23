package top.izuna.foliamajor.bilibili;

import okhttp3.Call;

// Cancellation covers queued work as well as whichever HTTP call is currently running.
final class BilibiliRequest {
    private boolean cancelled;
    private Call active;

    synchronized void attach(Call call) {
        active = call;
        if (cancelled) call.cancel();
    }

    synchronized void cancel() {
        cancelled = true;
        if (active != null) active.cancel();
    }

    synchronized boolean isCancelled() { return cancelled; }
}
