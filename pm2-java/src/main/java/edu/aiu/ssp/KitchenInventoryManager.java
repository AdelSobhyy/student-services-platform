package edu.aiu.ssp;

import java.time.*;

public record KitchenInventoryManager(IDiningDB db) {
  public Meal getStockStatus(String id) {
    return db.findMeal(id);
  }
}
