package edu.aiu.ssp;

/** Events represent completed business decisions, including payment and deadline outcomes. */
public enum Lifecycle {
  User,
  Room,
  Booking,
  TransportBooking,
  Membership,
  Club,
  MealOrder,
  Meal,
  SupportTicket,
  Notification,
  Payment,
  Refund,
  Reservation;

  public String next(String from, String event) {
    return switch (this) {
      case User ->
          switch (from + "/" + event) {
            case "INITIAL/register" -> "ACTIVE";
            case "ACTIVE/suspend" -> "SUSPENDED";
            case "SUSPENDED/activate" -> "ACTIVE";
            case "ACTIVE/deactivate" -> "DEACTIVATED";
            case "SUSPENDED/deactivate" -> "DEACTIVATED";
            case "DEACTIVATED/activate" -> "ACTIVE";
            case "DEACTIVATED/close" -> "END";
            default -> throw invalid(from, event);
          };
      case Room ->
          switch (from + "/" + event) {
            case "INITIAL/create" -> "AVAILABLE";
            case "AVAILABLE/bookLastSpace" -> "BOOKED";
            case "BOOKED/release" -> "AVAILABLE";
            case "AVAILABLE/maintain" -> "MAINTENANCE";
            case "MAINTENANCE/restore" -> "AVAILABLE";
            case "AVAILABLE/remove" -> "END";
            default -> throw invalid(from, event);
          };
      case Booking ->
          switch (from + "/" + event) {
            case "INITIAL/book" -> "PENDING";
            case "PENDING/paid" -> "CONFIRMED";
            case "PENDING/declined" -> "FAILED";
            case "CONFIRMED/cancel" -> "CANCELLED";
            case "PENDING/cancel" -> "CANCELLED";
            case "CONFIRMED/checkout" -> "COMPLETED";
            default -> throw invalid(from, event);
          };
      case TransportBooking ->
          switch (from + "/" + event) {
            case "INITIAL/book" -> "PENDING";
            case "PENDING/paid" -> "CONFIRMED";
            case "PENDING/declined" -> "FAILED";
            case "CONFIRMED/cancel" -> "CANCELLED";
            case "CONFIRMED/complete" -> "COMPLETED";
            default -> throw invalid(from, event);
          };
      case Membership ->
          switch (from + "/" + event) {
            case "INITIAL/join" -> "ACTIVE";
            case "ACTIVE/leave" -> "LEFT";
            case "LEFT/join" -> "ACTIVE";
            case "LEFT/remove" -> "END";
            default -> throw invalid(from, event);
          };
      case Club ->
          switch (from + "/" + event) {
            case "INITIAL/propose" -> "PENDING";
            case "PENDING/approve" -> "APPROVED";
            case "PENDING/reject" -> "REJECTED";
            case "APPROVED/suspend" -> "SUSPENDED";
            case "SUSPENDED/approve" -> "APPROVED";
            default -> throw invalid(from, event);
          };
      case MealOrder ->
          switch (from + "/" + event) {
            case "INITIAL/order" -> "CREATED";
            case "CREATED/paid" -> "PAID";
            case "CREATED/declined" -> "PAYMENT_FAILED";
            case "PAID/cancelBeforeDeadline" -> "CANCELLED";
            case "PAID/serve" -> "COMPLETED";
            default -> throw invalid(from, event);
          };
      case Meal ->
          switch (from + "/" + event) {
            case "INITIAL/create" -> "AVAILABLE";
            case "AVAILABLE/soldOut" -> "OUT_OF_STOCK";
            case "OUT_OF_STOCK/restock" -> "AVAILABLE";
            case "OUT_OF_STOCK/remove" -> "END";
            case "AVAILABLE/restock" -> "AVAILABLE";
            default -> throw invalid(from, event);
          };
      case SupportTicket ->
          switch (from + "/" + event) {
            case "INITIAL/submit" -> "OPEN";
            case "OPEN/reply" -> "IN_PROGRESS";
            case "IN_PROGRESS/reply" -> "IN_PROGRESS";
            case "IN_PROGRESS/resolve" -> "RESOLVED";
            case "OPEN/resolve" -> "RESOLVED";
            case "RESOLVED/reopen" -> "OPEN";
            case "RESOLVED/close" -> "END";
            default -> throw invalid(from, event);
          };
      case Notification ->
          switch (from + "/" + event) {
            case "INITIAL/send" -> "PENDING";
            case "PENDING/delivered" -> "SENT";
            case "PENDING/failed" -> "FAILED";
            case "SENT/read" -> "READ";
            default -> throw invalid(from, event);
          };
      case Payment ->
          switch (from + "/" + event) {
            case "INITIAL/save" -> "PENDING";
            case "PENDING/paid" -> "PAID";
            case "PENDING/declined" -> "FAILED";
            case "PAID/refundIssued" -> "REFUNDED";
            default -> throw invalid(from, event);
          };
      case Refund ->
          switch (from + "/" + event) {
            case "INITIAL/request" -> "REQUESTED";
            case "REQUESTED/approve" -> "APPROVED";
            case "REQUESTED/reject" -> "REJECTED";
            case "APPROVED/issued" -> "ISSUED";
            case "APPROVED/failed" -> "FAILED";
            default -> throw invalid(from, event);
          };
      case Reservation ->
          switch (from + "/" + event) {
            case "INITIAL/reserve" -> "RESERVED";
            case "RESERVED/collect" -> "COLLECTED";
            case "RESERVED/cancel" -> "CANCELLED";
            case "RESERVED/expire" -> "EXPIRED";
            case "COLLECTED/returnBook" -> "RETURNED";
            default -> throw invalid(from, event);
          };
    };
  }

  private IllegalStateException invalid(String from, String event) {
    return new IllegalStateException(name() + ": " + event + " rejected in " + from);
  }
}
