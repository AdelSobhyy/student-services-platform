package edu.aiu.ssp;

import java.time.*;

public record MembershipManager(
    IAccount account, ClubBrowser browser, IClubDB db, Identifiers ids) {
  public boolean joinClub(String studentId, String clubId) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Club club = browser.getClub(clubId);
    if (club == null || !"APPROVED".equals(club.status())) throw new ClubNotAvailableException();
    Membership previous = db.findMembership(studentId, clubId);
    if (previous != null && "ACTIVE".equals(previous.status())) return false;
    String status =
        Lifecycle.Membership.next(previous == null ? "INITIAL" : previous.status(), "join");
    db.saveMembership(
        new Membership(
            previous == null ? ids.next("membership") : previous.id(), studentId, clubId, status));
    return true;
  }

  /** ACTIVE -> LEFT. LEFT -> ACTIVE is already supported by re-calling joinClub. */
  public boolean leaveClub(String studentId, String clubId) {
    Membership current = db.findMembership(studentId, clubId);
    if (current == null) throw new InvalidStateException();
    String next = Lifecycle.Membership.next(current.status(), "leave");
    db.saveMembership(new Membership(current.id(), studentId, clubId, next));
    return true;
  }

  /** LEFT -> END when a membership record is removed. */
  public boolean removeMembership(String studentId, String clubId) {
    Membership current = db.findMembership(studentId, clubId);
    if (current == null) throw new InvalidStateException();
    String next = Lifecycle.Membership.next(current.status(), "remove");
    db.saveMembership(new Membership(current.id(), studentId, clubId, next));
    return true;
  }
}
