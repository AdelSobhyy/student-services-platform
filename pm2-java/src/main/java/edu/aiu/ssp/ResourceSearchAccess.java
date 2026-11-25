package edu.aiu.ssp;

import java.time.*;

public record ResourceSearchAccess(
    IAccount account, CatalogManager catalog, ILibraryDB db, Identifiers ids) {
  public Resource accessResource(String resourceId, String studentId) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Resource resource = catalog.getResource(resourceId);
    if (resource == null || !resource.active()) throw new ResourceNotFoundException();
    if ("DIGITAL".equals(resource.type())) {
      db.logDownload(resourceId, studentId);
      return resource;
    }
    if (resource.copiesAvailable() < 1) throw new CopiesNotAvailableException();
    db.saveReservation(
        new Reservation(
            ids.next("reservation"),
            studentId,
            resourceId,
            Lifecycle.Reservation.next("INITIAL", "reserve")));
    db.updateCopies(resourceId, -1);
    return new Resource(
        resourceId, resource.type(), resource.title(), resource.copiesAvailable() - 1, true);
  }

  /** RESERVED -> COLLECTED (FR23.1). */
  public Reservation collectReservation(String reservationId) {
    return withPersistedStatus(reservationId, "collect");
  }

  /** RESERVED -> CANCELLED, returning the reserved copy to the shelf. */
  public Reservation cancelReservation(String reservationId) {
    Reservation result = withPersistedStatus(reservationId, "cancel");
    db.updateCopies(result.resourceId(), 1);
    return result;
  }

  /** RESERVED -> EXPIRED when the collection deadline passes. */
  public Reservation expireReservation(String reservationId) {
    return withPersistedStatus(reservationId, "expire");
  }

  /** COLLECTED -> RETURNED, restoring the copy after the book comes back. */
  public Reservation returnBook(String reservationId) {
    Reservation result = withPersistedStatus(reservationId, "returnBook");
    db.updateCopies(result.resourceId(), 1);
    return result;
  }

  private Reservation withPersistedStatus(String reservationId, String event) {
    Reservation reservation = db.findReservation(reservationId);
    if (reservation == null) throw new ValidationException();
    Reservation result =
        new Reservation(
            reservation.id(),
            reservation.studentId(),
            reservation.resourceId(),
            Lifecycle.Reservation.next(reservation.status(), event));
    db.updateReservationStatus(result.id(), result.status());
    return result;
  }
}
