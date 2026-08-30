-- 回归用例没有执行器和结果消费链路，移除闲置表及其中未生效的数据。
DROP TABLE IF EXISTS `evaluation_cases`;
