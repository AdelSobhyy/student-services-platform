package edu.aiu.ssp;

/** Raised when a support-ticket operation references an unknown ticket. */
public class TicketNotFoundException extends IllegalStateException {
  public TicketNotFoundException(String id) {
    super("Ticket not found: " + id);
  }
}
