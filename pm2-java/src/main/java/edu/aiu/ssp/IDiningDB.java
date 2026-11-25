package edu.aiu.ssp;

import java.time.*;
import java.util.List;

public interface IDiningDB {
  Meal findMeal(String id);

  void saveMeal(Meal meal);

  List<DietaryRestriction> findDietaryPreferences(String studentId);

  void saveOrder(MealOrder order);

  MealOrder findOrder(String id);

  void updateOrderStatus(String id, String status);

  void updateMealStockStatus(String id, String status);
}
