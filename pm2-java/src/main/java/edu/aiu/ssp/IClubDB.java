package edu.aiu.ssp;

import java.time.*;

public interface IClubDB {
  Club findClub(String id);

  void saveClub(Club club);

  Membership findMembership(String studentId, String clubId);

  void saveMembership(Membership membership);

  void updateClubStatus(String id, String status);
}
