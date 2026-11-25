package edu.aiu.ssp;

import java.time.*;

public record ClubApprovalManager(IAccount account, IClubDB db, ICommunication comm) {
  public void approveClub(String adminId, String clubId) {
    requireAdmin(adminId);
    Club club = requireClub(clubId);
    if (!("PENDING".equals(club.status()) || "SUSPENDED".equals(club.status())))
      throw new InvalidStateException();
    transition(club, "approve", "approved");
  }

  /** PENDING -> REJECTED (FR14.1 / Club state diagram). */
  public void rejectClub(String adminId, String clubId) {
    requireAdmin(adminId);
    Club club = requireClub(clubId);
    if (!"PENDING".equals(club.status())) throw new InvalidStateException();
    transition(club, "reject", "rejected");
  }

  /** APPROVED -> SUSPENDED (FR14.2 / Club state diagram). */
  public void suspendClub(String adminId, String clubId) {
    requireAdmin(adminId);
    Club club = requireClub(clubId);
    if (!"APPROVED".equals(club.status())) throw new InvalidStateException();
    transition(club, "suspend", "suspended");
  }

  private void requireAdmin(String adminId) {
    if (!account.verifyRole(adminId, "ADMIN")) throw new UnauthorizedException();
  }

  private Club requireClub(String clubId) {
    Club club = db.findClub(clubId);
    if (club == null) throw new InvalidStateException();
    return club;
  }

  private void transition(Club club, String event, String message) {
    db.updateClubStatus(club.id(), Lifecycle.Club.next(club.status(), event));
    comm.sendNotification(club.proposedBy(), club.name() + " " + message);
  }
}
