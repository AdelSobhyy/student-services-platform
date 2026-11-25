package edu.aiu.ssp;

/** INITIAL -> PENDING for a proposed club (FR13.1 / Club state diagram). */
public record ClubProposalManager(IClubDB db, Identifiers ids) {
  public Club propose(String studentId, String name, String category) {
    Club club =
        new Club(
            ids.next("club"),
            name,
            category,
            studentId,
            Lifecycle.Club.next("INITIAL", "propose"));
    db.saveClub(club);
    return club;
  }
}
