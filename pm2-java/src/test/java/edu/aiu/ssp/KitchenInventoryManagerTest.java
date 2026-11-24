package edu.aiu.ssp;

import static edu.aiu.ssp.Fixtures.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class KitchenInventoryManagerTest {
  @Mock IDiningDB db;
  @InjectMocks KitchenInventoryManager service;

  @Test
  void readsGrilledChickenStock() {
    when(db.findMeal("M-55")).thenReturn(CHICKEN);
    assertEquals(CHICKEN, service.getStockStatus("M-55"));
    verify(db).findMeal("M-55");
  }
}
