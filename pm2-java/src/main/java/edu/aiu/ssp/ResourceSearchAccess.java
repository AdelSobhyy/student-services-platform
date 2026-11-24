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
}
