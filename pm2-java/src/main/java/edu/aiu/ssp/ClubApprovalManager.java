package edu.aiu.ssp;

import java.time.*;

public record ClubApprovalManager(IAccount account, IClubDB db, ICommunication comm) {
  public void approveClub(String adminId, String clubId) {
    if (!account.verifyRole(adminId, "ADMIN")) throw new UnauthorizedException();
    Club club = db.findClub(clubId);
    if (club == null || !("PENDING".equals(club.status()) || "SUSPENDED".equals(club.status())))
      throw new InvalidStateException();
    db.updateClubStatus(clubId, Lifecycle.Club.next(club.status(), "approve"));
    comm.sendNotification(club.proposedBy(), club.name() + " approved");
  }
}
