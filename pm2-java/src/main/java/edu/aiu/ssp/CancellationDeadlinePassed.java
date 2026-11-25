package edu.aiu.ssp;

/** Raised when a meal order is cancelled after its cancellation deadline. */
public class CancellationDeadlinePassed extends IllegalStateException {
  public CancellationDeadlinePassed() {
    super("Cancellation deadline has passed");
  }
}
