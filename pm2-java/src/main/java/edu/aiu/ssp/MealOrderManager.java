package edu.aiu.ssp;

import java.time.*;
import java.util.List;

public record MealOrderManager(
    IAccount account,
    KitchenInventoryManager inventory,
    DietaryPreferenceManager dietary,
    IDiningDB db,
    IPayment payment,
    ICommunication comm,
    Identifiers ids) {
  public MealOrder orderMeal(String studentId, String mealId) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Meal meal = inventory.getStockStatus(mealId);
    if (meal == null || !"AVAILABLE".equals(meal.stockStatus()))
      throw new MealUnavailableException();
    List<DietaryRestriction> conflicts = dietary.highlightConflicts(studentId, mealId);
    MealOrder order =
        new MealOrder(
            ids.next("order"),
            studentId,
            mealId,
            meal.price(),
            conflicts,
            Lifecycle.MealOrder.next("INITIAL", "order"));
    db.saveOrder(order);
    boolean paid = payment.payFees(studentId, "MEAL", order.id(), order.amount());
    MealOrder result = order.after(paid ? "paid" : "declined");
    db.updateOrderStatus(result.id(), result.status());
    if (paid) comm.sendNotification(studentId, "Order " + result.id() + " paid");
    return result;
  }
}
