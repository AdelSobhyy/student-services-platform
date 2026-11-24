package edu.aiu.ssp;

import java.time.*;

public record InventoryManager(IAccommodationDB db) {
  public Room isAvailable(String id, Dates dates) {
    Room room = db.findRoom(id);
    return room != null
            && room.spaces() > 0
            && "AVAILABLE".equals(room.status())
            && !db.overlaps(id, dates)
        ? room
        : null;
  }

  public void updateAvailability(String id, String status) {
    db.updateRoomStatus(id, status);
  }
}
