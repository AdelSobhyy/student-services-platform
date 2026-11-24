package edu.aiu.ssp;

import java.time.*;

public interface IClubDB {
  Club findClub(String id);

  Membership findMembership(String studentId, String clubId);

  void saveMembership(Membership membership);

  void updateClubStatus(String id, String status);
}
