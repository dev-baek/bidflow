package com.bidflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class BidFlowApplication {

    public static void main(String[] args) {
        SpringApplication.run(BidFlowApplication.class, args);
    }
}
